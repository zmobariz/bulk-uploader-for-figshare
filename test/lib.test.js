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

test('update.cmpVersion orders versions', () => {
  assert.equal(cmpVersion('2.2.0', '2.1.3'), 1);
  assert.equal(cmpVersion('v2.1.3', '2.1.3'), 0);
  assert.equal(cmpVersion('2.1.10', '2.1.9'), 1);
  assert.equal(cmpVersion('2.0.0', '2.0.1-beta'), -1);
});
