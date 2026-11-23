/** Unit tests for the shared library code (offline). Run with `npm test`. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const guard = require('../lib/guard');
const fig = require('../lib/figshare');
const { cmpVersion } = require('../lib/update');

test('guard.hostnameOf strips ports and IPv6 brackets', () => {
  assert.equal(guard.hostnameOf('127.0.0.1:4000'), '127.0.0.1');
  assert.equal(guard.hostnameOf('[::1]:4000'), '::1');
  assert.equal(guard.hostnameOf('LocalHost'), 'localhost');
  assert.equal(guard.hostnameOf(''), '');
});

test('guard.allowedHosts defaults to loopback, extends, and "*" disables', () => {
  const d = guard.allowedHosts('');
  assert.deepEqual([...d].sort(), ['127.0.0.1', '::1', 'localhost']);
  assert.ok(guard.allowedHosts('Uploader.Example.ac.uk, x.y').has('uploader.example.ac.uk'));
  assert.equal(guard.allowedHosts('*'), null);
});

// Drive the guard middleware directly with fake requests (proxy scenarios need TRUST_PROXY).
function runGuard(mw, headers, method = 'POST') {
  let status = 0; let nextCalled = false;
  const res = { status(s) { status = s; return this; }, json() { return this; } };
  mw({ method, headers }, res, () => { nextCalled = true; });
  return nextCalled ? 'next' : status;
}

test('guard behind a trusted reverse proxy: one effective host for allow-list and Origin', () => {
  const mw = guard.hostAndOrigin(guard.allowedHosts('uploader.example.ac.uk'), { trustProxy: true });
  const h = (o) => Object.assign({ host: 'uploader:4000', 'x-forwarded-proto': 'https' }, o);
  // Docker proxy to a service name: the forwarded public name is what gets allow-listed
  assert.equal(runGuard(mw, h({ 'x-forwarded-host': 'uploader.example.ac.uk', origin: 'https://uploader.example.ac.uk' })), 'next');
  // a catch-all proxy forwarding an unlisted alias is refused, even with a matching Origin
  assert.equal(runGuard(mw, h({ 'x-forwarded-host': 'alias.example', origin: 'https://alias.example' })), 421);
  // a bare host means the default port (never "any port"); $http_host forwards a non-default one;
  // an explicit :443 matches the default
  assert.equal(runGuard(mw, h({ 'x-forwarded-host': 'uploader.example.ac.uk', origin: 'https://uploader.example.ac.uk' })), 'next');
  assert.equal(runGuard(mw, h({ 'x-forwarded-host': 'uploader.example.ac.uk', origin: 'https://uploader.example.ac.uk:8443' })), 403);
  assert.equal(runGuard(mw, h({ 'x-forwarded-host': 'uploader.example.ac.uk:8443', origin: 'https://uploader.example.ac.uk:8443' })), 'next');
  assert.equal(runGuard(mw, h({ 'x-forwarded-host': 'uploader.example.ac.uk:443', origin: 'https://uploader.example.ac.uk' })), 'next');
  assert.equal(runGuard(mw, h({ 'x-forwarded-host': 'uploader.example.ac.uk:8443', origin: 'https://uploader.example.ac.uk:9443' })), 403);
  // scheme must match: an http page cannot post to the https deployment
  assert.equal(runGuard(mw, h({ 'x-forwarded-host': 'uploader.example.ac.uk', origin: 'http://uploader.example.ac.uk' })), 403);
  // foreign origin
  assert.equal(runGuard(mw, h({ 'x-forwarded-host': 'uploader.example.ac.uk', origin: 'https://attacker.example' })), 403);
});

test('guard without a trusted proxy ignores forwarded headers', () => {
  const mw = guard.hostAndOrigin(guard.allowedHosts(''));
  assert.equal(runGuard(mw, { host: 'attacker.example', 'x-forwarded-host': 'localhost' }, 'GET'), 421);
  assert.equal(runGuard(mw, { host: '127.0.0.1:4000', origin: 'http://127.0.0.1:4000' }), 'next');
  assert.equal(runGuard(mw, { host: '[::1]:4000', origin: 'http://[::1]:4000' }), 'next');
  assert.equal(runGuard(mw, { host: 'localhost:4000', origin: 'http://localhost:4001' }), 403);
  assert.equal(runGuard(mw, { host: '127.0.0.1:4000' }), 'next'); // CLI / curl: no Origin
});

test('guard.isArticleId accepts positive integers only', () => {
  for (const v of ['1', '42', '123456789012']) assert.ok(guard.isArticleId(v), v);
  for (const v of ['0', '-1', '1.5', '1a', '1/2', '<x>', '', ' ', '12345678901234567']) assert.ok(!guard.isArticleId(v), v);
});

test('figshare.cleanBase defaults and strips trailing slashes', () => {
  assert.equal(fig.cleanBase(''), fig.DEFAULT_BASE);
  assert.equal(fig.cleanBase('https://api.figshare.com/v2///'), 'https://api.figshare.com/v2');
});

test('figshare.figApi refuses non-allow-listed hosts before any network I/O', async () => {
  for (const b of ['http://api.figshare.com/v2', 'https://evilfigshare.com', 'https://figshare.com.evil.io', 'file:///etc/passwd', 'https://10.0.0.1']) {
    await assert.rejects(fig.figApi(b, '/account', 't', { method: 'GET' }), /Blocked non-Figshare request/, b);
  }
});

test('runOperation validates Article IDs for operations that use them, before any request', async () => {
  for (const operation of ['update', 'publish', 'delete', 'addfiles']) {
    await assert.rejects(fig.runOperation({ base: 'https://127.0.0.1', token: 't', operation, articleId: '1<img src=x>', metadata: {} }), /Article ID must be a number/, operation);
  }
  // create ignores the supplied ID and proceeds to the (blocked) create call
  await assert.rejects(fig.runOperation({ base: 'https://127.0.0.1', token: 't', operation: 'create', articleId: 'LAB-42', metadata: { title: 'abc' } }), /Blocked non-Figshare request/);
});

test('pre-flight blocks a non-numeric Article ID only for operations that use it', () => {
  const M = require('../public/shared.js');
  const mapping = { fields: { title: 'Title', articleId: 'ID' }, customFields: {}, defaults: { categories: [], license: null, defined_type: '', group_id: null } };
  const rows = [{ Title: 'Alpha dataset', ID: 'LAB-42' }, { Title: 'Beta dataset', ID: '123' }];
  const ctx = (operation) => ({ operation, sync: 'create', mode: 'metadata', publish: false, lookups: null, existing: [], fileSet: new Set() });
  const upd = M.preflight(rows, mapping, ctx('update'));
  assert.equal(upd.blocking, true);
  assert.equal(upd.rows[0].bucket, 'error');
  assert.match(upd.rows[0].issues.join(' '), /not a Figshare ID/);
  assert.equal(upd.rows[1].bucket, 'ok');
  const crt = M.preflight(rows, mapping, ctx('create'));
  assert.equal(crt.blocking, false);
});

test('pre-flight blocks rows with more files than the server accepts', () => {
  const M = require('../public/shared.js');
  const names = Array.from({ length: fig.MAX_FILES_PER_ROW + 1 }, (_, i) => `f${i}.txt`);
  const mapping = { fields: { title: 'Title', files: 'Files' }, customFields: {}, defaults: { categories: [], license: null, defined_type: '', group_id: null } };
  const rows = [{ Title: 'Many files', Files: names.join(';') }];
  const ctx = (o) => Object.assign({ operation: 'create', sync: 'create', mode: 'files', publish: false, lookups: null, existing: [], fileSet: new Set(names), maxFilesPerRow: fig.MAX_FILES_PER_ROW }, o);
  const rep = M.preflight(rows, mapping, ctx({}));
  assert.equal(rep.blocking, true);
  assert.match(rep.rows[0].issues.join(' '), /Too many files/);
  // a row that will be skipped as an existing duplicate uploads nothing: not held to the cap
  const skip = M.preflight(rows, mapping, ctx({ sync: 'skip', existing: [{ id: 9, title: 'Many files' }] }));
  assert.doesNotMatch(skip.rows[0].issues.join(' '), /Too many files/);
  // the CLI passes no cap (it uploads files one by one)
  const cli = M.preflight(rows, mapping, ctx({ maxFilesPerRow: undefined }));
  assert.equal(cli.blocking, false);
});

test('results CSV neutralises formulas without changing delimiters', () => {
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'cli.js'), 'utf8');
  const csvCell = new Function(`${src.match(/function csvCell[\s\S]*?\n}/)[0]}; return csvCell;`)();
  assert.equal(csvCell('=HYPERLINK("http://x")'), `"'=HYPERLINK(""http://x"")"`);
  for (const v of ['+1', '-1', '@SUM(A1)']) assert.equal(csvCell(v), "'" + v);
  assert.equal(csvCell('plain title'), 'plain title');
  assert.equal(csvCell('a,b'), '"a,b"');
  assert.equal(csvCell('Sample;'), 'Sample;'); // not quoted: quoting here breaks ;-delimited re-import
});

test('update.cmpVersion orders versions', () => {
  assert.equal(cmpVersion('2.2.0', '2.1.3'), 1);
  assert.equal(cmpVersion('v2.1.3', '2.1.3'), 0);
  assert.equal(cmpVersion('2.1.10', '2.1.9'), 1);
  assert.equal(cmpVersion('2.0.0', '2.0.1-beta'), -1);
});
