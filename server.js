/**
 * Bulk Uploader for Figshare — web server (thin layer over lib/figshare.js)
 * Serves the SPA and proxies/orchestrates the Figshare API.
 * Tokens are supplied per request and never written to disk or logged.
 */
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const fig = require('./lib/figshare');
const update = require('./lib/update');
const guard = require('./lib/guard');

const app = express();
const PORT = process.env.PORT || 4000;
const HOST = process.env.HOST || '127.0.0.1'; // loopback by default; Docker sets 0.0.0.0

// A fresh private directory per server process: mkdtemp creates it 0700, so other local
// accounts cannot list or read attachments, and it never collides with another user's dir.
const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'figshare-uploader-'));
const cleanTmpDir = () => { try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch (e) { /* best effort */ } };
process.on('exit', cleanTmpDir);
for (const sig of ['SIGINT', 'SIGTERM']) process.once(sig, () => { cleanTmpDir(); process.exit(0); });

const upload = multer({
  storage: multer.diskStorage({
    destination: (_q, _f, cb) => cb(null, TMP_DIR),
    // Random on-disk name: the client-supplied name never touches the filesystem
    // (it is kept only as file.originalname and sent to Figshare as the file's name).
    // Every path is recorded on the request so it is removed on every exit path,
    // including a write error part-way through a file.
    filename: (req, _f, cb) => {
      const name = crypto.randomUUID();
      (req.tmpPaths || (req.tmpPaths = [])).push(path.join(TMP_DIR, name));
      cb(null, name);
    },
  }),
  // The UI sends the token before any file, so a request without one never writes to disk.
  fileFilter: (req, _f, cb) => {
    if (!req.body || !req.body.token) { const err = new Error('Token is required.'); err.status = 400; return cb(err); }
    cb(null, true);
  },
  limits: { fileSize: 1024 * 1024 * 1024 * 20, files: 500, fields: 50, fieldSize: 8 * 1024 * 1024 },
});
const removeTmp = (req) => Promise.all((req.tmpPaths || []).map((p) => fsp.unlink(p).catch(() => {})));
// multer, then always clean up if parsing fails (the route's own finally does it on success).
const uploadFiles = (req, res, next) => upload.array('files')(req, res, (err) => {
  if (err) return removeTmp(req).then(() => next(err));
  next();
});

app.disable('x-powered-by');
app.use(guard.securityHeaders);
app.use(guard.hostAndOrigin(guard.allowedHosts(process.env.ALLOWED_HOSTS)));
app.use(express.json({ limit: '8mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/samples', express.static(path.join(__dirname, 'samples')));

const fail = (res, e) => res.status(e.status || 502).json({ ok: false, error: e.message });
const safeUnlink = (p) => fsp.unlink(p).catch(() => {});

app.get('/api/health', (_q, res) => res.json({ ok: true, version: require('./package.json').version }));

app.get('/api/version', async (req, res) => {
  const info = await update.checkForUpdate({ force: String(req.query.force || '') === '1' });
  res.json({ ok: true, repo: update.REPO, ...info });
});

app.post('/api/test-token', async (req, res) => {
  const { token, baseUrl } = req.body || {};
  if (!token) return res.status(400).json({ ok: false, error: 'Token is required.' });
  try {
    const a = await fig.getAccount(baseUrl, token);
    res.json({ ok: true, account: { id: a.id, name: [a.first_name, a.last_name].filter(Boolean).join(' ') || a.email, email: a.email } });
  } catch (e) { fail(res, e); }
});

app.post('/api/lookups', async (req, res) => {
  const { token, baseUrl } = req.body || {};
  if (!token) return res.status(400).json({ ok: false, error: 'Token is required.' });
  try {
    const [categories, licenses, customFields] = await Promise.all([
      fig.getCategories(baseUrl, token), fig.getLicenses(baseUrl, token), fig.getCustomFields(baseUrl, token),
    ]);
    res.json({ ok: true, categories, licenses, customFields });
  } catch (e) { fail(res, e); }
});

// List the account's existing articles (for de-dup / update-by-title).
app.post('/api/list-articles', async (req, res) => {
  const { token, baseUrl } = req.body || {};
  if (!token) return res.status(400).json({ ok: false, error: 'Token is required.' });
  try {
    const all = await fig.listAllArticles(baseUrl, token);
    res.json({ ok: true, articles: all.map((a) => ({ id: a.id, title: a.title, doi: a.doi, url: a.url, published: !!a.published_date })) });
  } catch (e) { fail(res, e); }
});

// Process one row (any operation).
app.post('/api/process', uploadFiles, async (req, res) => {
  const files = (req.files || []).map((f) => ({ path: f.path, name: f.originalname }));
  try {
    const b = req.body;
    if (!b.token) throw new Error('Token is required.');
    let metadata = {};
    if (b.metadata) { try { metadata = JSON.parse(b.metadata); } catch { throw new Error('Invalid metadata payload.'); } }
    let embargo = null;
    if (b.embargo) { try { embargo = JSON.parse(b.embargo); } catch { /* ignore */ } }

    const result = await fig.runOperation({
      base: b.baseUrl, token: b.token,
      operation: b.operation || 'create',
      mode: b.mode || 'metadata',
      publish: String(b.publish) === 'true',
      reserveDoi: String(b.reserveDoi) === 'true',
      embargo,
      metadata,
      articleId: b.articleId || null,
      files,
    });

    const id = result.articleId;
    res.json({
      ok: true,
      ...result,
      privateUrl: id ? `https://figshare.com/account/articles/${id}` : null,
    });
  } catch (e) { fail(res, e); }
  finally { await Promise.all([...files.map((f) => safeUnlink(f.path)), removeTmp(req)]); }
});

// Last-resort handler: generic JSON, never a stack trace.
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err); // let Express close the half-sent response
  let status = err.status || err.statusCode;
  if (!status) {
    if (err.name === 'MulterError') status = 400;
    else if (err.code && /^E[A-Z]+$/.test(err.code)) status = 500; // filesystem/OS error (e.g. ENOSPC)
    else if (req.path === '/api/process') status = 400; // malformed multipart body (busboy)
    else status = 500;
  }
  res.status(status).json({ ok: false, error: status < 500 ? err.message : 'Internal error' });
});

app.listen(PORT, HOST, () => {
  console.log('\n  Bulk Uploader for Figshare v2');
  console.log('  ----------------------------------------');
  console.log(`  Open  ->  http://127.0.0.1:${PORT}`);
  console.log('  Press Ctrl+C to stop.\n');
});
