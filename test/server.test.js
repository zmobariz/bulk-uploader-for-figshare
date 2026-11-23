/**
 * Server security + behaviour tests. Offline: no request ever reaches Figshare
 * (every Figshare-bound call here is either refused locally or aimed at a
 * blocked host). Run with `npm test`.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');

const ROOT = path.join(__dirname, '..');
const tmpDirs = () => new Set(fs.readdirSync(os.tmpdir()).filter((f) => f.startsWith('figshare-uploader-')));
let proc; let base; let port; let TMP_DIR;

const freePort = () => new Promise((resolve, reject) => {
  const s = net.createServer(); s.on('error', reject);
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
});

before(async () => {
  port = await freePort();
  base = `http://127.0.0.1:${port}`;
  const existing = tmpDirs();
  proc = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', NO_UPDATE_CHECK: '1' }, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(`${base}/api/health`);
      if (r.ok) {
        const mine = [...tmpDirs()].filter((d) => !existing.has(d));
        assert.equal(mine.length, 1, 'server creates exactly one private temp dir');
        TMP_DIR = path.join(os.tmpdir(), mine[0]);
        return;
      }
    } catch (e) { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('server did not start');
});
after(async () => {
  if (!proc) return;
  const exited = new Promise((r) => proc.once('exit', r));
  proc.kill('SIGTERM'); await exited;
  if (process.platform !== 'win32') assert.equal(fs.existsSync(TMP_DIR), false, 'temp dir removed on shutdown');
});

// fetch() cannot override Host, so raw requests go through node:http.
const raw = (opts, body) => new Promise((resolve, reject) => {
  const req = require('node:http').request({ host: '127.0.0.1', port, ...opts }, (res) => {
    let d = ''; res.on('data', (c) => { d += c; }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: d }));
  });
  req.on('error', reject); if (body) req.write(body); req.end();
});
const postJson = (route, obj, headers = {}) => fetch(base + route, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(obj) });

test('health reports the package version', async () => {
  const j = await (await fetch(`${base}/api/health`)).json();
  assert.equal(j.ok, true);
  assert.equal(j.version, require('../package.json').version);
});

test('UI is served with a strict CSP and hardening headers', async () => {
  const r = await fetch(`${base}/`);
  assert.equal(r.status, 200);
  const csp = r.headers.get('content-security-policy');
  assert.match(csp, /script-src 'self'(;|$)/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /object-src 'none'/);
  assert.doesNotMatch(csp, /unsafe-eval/);
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(r.headers.get('x-frame-options'), 'DENY');
  assert.equal(r.headers.get('x-powered-by'), null);
});

test('foreign Host header is refused (DNS-rebinding defence)', async () => {
  const r = await raw({ path: '/api/health', headers: { host: 'attacker.example:' + port } });
  assert.equal(r.status, 421);
  const ok = await raw({ path: '/api/health', headers: { host: 'localhost:' + port } });
  assert.equal(ok.status, 200);
});

test('cross-origin POST is refused (CSRF defence)', async () => {
  // No token in the body: without the origin guard the handler would answer 400, so 403 proves the guard ran.
  for (const headers of [{ origin: 'https://attacker.example' }, { 'sec-fetch-site': 'cross-site' }, { origin: 'null' }]) {
    const r = await postJson('/api/test-token', {}, headers);
    assert.equal(r.status, 403, JSON.stringify(headers));
    assert.match((await r.json()).error, /Cross-origin request refused/);
  }
  // A cross-site multipart form post (no CORS preflight) is refused too.
  const fd = new FormData(); fd.append('operation', 'delete'); fd.append('articleId', '1');
  const r4 = await fetch(`${base}/api/process`, { method: 'POST', body: fd, headers: { origin: 'https://attacker.example' } });
  assert.equal(r4.status, 403);
});

test('reverse proxy: Origin matching X-Forwarded-Host is accepted, a mismatch is not', async () => {
  const body = JSON.stringify({});
  const hdr = (origin, fwd) => ({ method: 'POST', path: '/api/test-token', headers: { host: `127.0.0.1:${port}`, 'content-type': 'application/json', 'content-length': Buffer.byteLength(body), origin, 'x-forwarded-host': fwd } });
  const req = (origin, fwd, proto) => { const o = hdr(origin, fwd); if (proto) o.headers['x-forwarded-proto'] = proto; return o; };
  const ok = await raw(req('https://uploader.example.ac.uk', 'uploader.example.ac.uk', 'https'), body);
  assert.equal(ok.status, 400); // reached the handler
  const bad = await raw(req('https://attacker.example', 'uploader.example.ac.uk', 'https'), body);
  assert.equal(bad.status, 403);
  // scheme must match too: an http:// page cannot post to the https:// deployment
  const scheme = await raw(req('http://uploader.example.ac.uk', 'uploader.example.ac.uk', 'https'), body);
  assert.equal(scheme.status, 403);
  // direct (no proxy): the server only speaks http, so an https Origin for the same host is foreign
  const direct = await postJson('/api/test-token', {}, { origin: `https://127.0.0.1:${port}` });
  assert.equal(direct.status, 403);
});

test('same-origin POST is accepted', async () => {
  const r = await postJson('/api/test-token', {}, { origin: base });
  assert.equal(r.status, 400); // reached the handler: "Token is required."
  assert.match((await r.json()).error, /Token is required/);
});

test('non-Figshare base URLs are blocked before any request (SSRF)', async () => {
  for (const baseUrl of ['http://169.254.169.254/latest', 'https://127.0.0.1', 'https://figshare.com.attacker.example', 'http://api.figshare.com/v2']) {
    const r = await postJson('/api/test-token', { token: 'x', baseUrl });
    assert.equal(r.status, 400, baseUrl);
    assert.match((await r.json()).error, /Blocked non-Figshare request/, baseUrl);
  }
});

test('non-numeric Article ID is refused (stops ID injection / reflected XSS)', async () => {
  for (const articleId of ['1<img src=x onerror=alert(1)>', '1/../../account', '12?x=1', '-5']) {
    const fd = new FormData();
    fd.append('token', 'x'); fd.append('operation', 'addfiles'); fd.append('articleId', articleId);
    const r = await fetch(`${base}/api/process`, { method: 'POST', body: fd });
    assert.equal(r.status, 400, articleId);
    assert.match((await r.json()).error, /Article ID must be a number/);
  }
});

test('Create ignores a non-numeric ID column (e.g. an auto-mapped "Identifier")', async () => {
  const fd = new FormData();
  fd.append('token', 'x'); fd.append('operation', 'create'); fd.append('articleId', 'LAB-42');
  fd.append('baseUrl', 'https://127.0.0.1'); // blocked -> fails fast, offline
  fd.append('metadata', JSON.stringify({ title: 'Dataset title' }));
  const j = await (await fetch(`${base}/api/process`, { method: 'POST', body: fd })).json();
  assert.doesNotMatch(j.error, /Article ID/);
  assert.match(j.error, /Blocked non-Figshare request/); // got as far as calling Figshare
});

test('private temp dir (0700) and no file is written without a token', async () => {
  if (process.platform !== 'win32') assert.equal(fs.statSync(TMP_DIR).mode & 0o777, 0o700);
  const fd = new FormData();
  fd.append('operation', 'addfiles'); fd.append('articleId', '1');
  fd.append('files', new Blob(['x'.repeat(1024)]), 'a.bin');
  const r = await fetch(`${base}/api/process`, { method: 'POST', body: fd });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /Token is required/);
  assert.deepEqual(fs.readdirSync(TMP_DIR), []);
});

test('malformed multipart body is a 400, not a 500', async () => {
  const r = await fetch(`${base}/api/process`, { method: 'POST', headers: { 'content-type': 'multipart/form-data' }, body: 'garbage' });
  assert.equal(r.status, 400);
  assert.equal((await r.json()).ok, false);
});

test('uploads use random temp names, ignore path components and are cleaned up', async () => {
  const before = new Set(fs.readdirSync(TMP_DIR));
  const fd = new FormData();
  fd.append('token', 'x'); fd.append('operation', 'addfiles'); fd.append('articleId', '1');
  fd.append('baseUrl', 'https://127.0.0.1'); // blocked -> fails fast, offline
  fd.append('files', new Blob(['hello']), '../../escape-test.txt');
  fd.append('files', new Blob(['hello']), '..\\..\\escape-test2.txt');
  const r = await fetch(`${base}/api/process`, { method: 'POST', body: fd });
  assert.equal(r.status, 400);
  assert.equal(fs.existsSync(path.join(os.tmpdir(), 'escape-test.txt')), false);
  assert.equal(fs.existsSync(path.join(os.tmpdir(), 'escape-test2.txt')), false);
  const leftover = fs.readdirSync(TMP_DIR).filter((f) => !before.has(f));
  assert.deepEqual(leftover, []);
});

test('malformed metadata and JSON are rejected without stack traces', async () => {
  const fd = new FormData(); fd.append('token', 'x'); fd.append('metadata', '{bad');
  const r = await fetch(`${base}/api/process`, { method: 'POST', body: fd });
  assert.match((await r.json()).error, /Invalid metadata payload/);
  const r2 = await fetch(`${base}/api/test-token`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{not json' });
  assert.equal(r2.status, 400);
  const t = await r2.text();
  assert.doesNotMatch(t, /at .*\.js:\d+/);
  assert.match(r2.headers.get('content-type'), /application\/json/);
});

test('lookups fail soft on an unreachable/blocked host', async () => {
  const r = await postJson('/api/lookups', { token: 'x', baseUrl: 'https://127.0.0.1' });
  const j = await r.json();
  assert.equal(j.ok, true);
  assert.deepEqual(j.categories, []);
});

test('update check honours NO_UPDATE_CHECK', async () => {
  const j = await (await fetch(`${base}/api/version`)).json();
  assert.equal(j.disabled, true);
  assert.equal(j.updateAvailable, false);
});
