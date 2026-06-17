/**
 * shared.js — mapping, metadata building + pre-flight checks.
 * Shared by the browser app and the CLI. UMD module.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FigMapping = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const FIG_FIELDS = [
    { key: 'title',        label: 'Title',                 type: 'string',  syn: ['title', 'name'] },
    { key: 'description',  label: 'Description',           type: 'string',  syn: ['description', 'abstract', 'summary'] },
    { key: 'keywords',     label: 'Keywords / tags',       type: 'list',    syn: ['keywords', 'tags', 'keyword'] },
    { key: 'categories',   label: 'Categories',            type: 'intlist', syn: ['categories', 'category'], resolve: 'category' },
    { key: 'authors',      label: 'Authors',               type: 'authors', syn: ['authors', 'author', 'creators', 'creator'] },
    { key: 'references',   label: 'References (URLs)',      type: 'list',    syn: ['references', 'reference', 'related', 'urls', 'url'] },
    { key: 'license',      label: 'License',               type: 'int',     syn: ['license', 'licence'], resolve: 'license' },
    { key: 'defined_type', label: 'Item type',             type: 'string',  syn: ['defined_type', 'item type', 'type'] },
    { key: 'funding',      label: 'Funding',               type: 'string',  syn: ['funding', 'grant', 'funder'] },
    { key: 'group_id',     label: 'Group ID',              type: 'int',     syn: ['group_id', 'group'] },
    { key: 'articleId',    label: 'Article ID',            type: 'string',  syn: ['article id', 'article_id', 'id', 'figshare id'], meta: false },
    { key: 'files',        label: 'File name(s)',          type: 'list',    syn: ['files', 'file', 'filename', 'file name', 'attachment', 'attachments'], meta: false },
  ];

  const ITEM_TYPES = ['figure','dataset','media','poster','journal contribution','presentation','thesis','software','online resource','preprint','book','conference contribution','chapter','peer review','educational resource','report','standard','composition','funding','physical object','data management plan','workflow','monograph','performance','event','service','model','registration'];

  const splitList = (raw, sep) => String(raw).split(sep || ';').map((s) => s.trim()).filter(Boolean);
  const baseName = (p) => String(p).split(/[\\/]/).pop().trim();
  const normTitle = (s) => String(s).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();

  function toAuthor(v) {
    v = String(v).trim();
    if (/^(\d{4}-){3}\d{3}[\dxX]$/.test(v)) return { orcid_id: v };
    if (/^\d+$/.test(v)) return { id: parseInt(v, 10) };
    return { name: v };
  }

  function resolveId(value, kind, lookups) {
    const raw = String(value).trim();
    const n = parseInt(raw, 10);
    if (!isNaN(n) && String(n) === raw) return n;
    if (!lookups) return null;
    const list = kind === 'category' ? (lookups.categories || []) : (lookups.licenses || []);
    const needle = raw.toLowerCase();
    const hit = list.find((x) => String(x.title || x.name || '').toLowerCase() === needle);
    if (!hit) return null;
    return kind === 'category' ? hit.id : (hit.value !== undefined ? hit.value : hit.id);
  }

  function buildRow(row, mapping, opts) {
    opts = opts || {};
    const fields = mapping.fields || {};
    const defaults = mapping.defaults || {};
    const meta = {};
    let fileNames = [];
    let articleId = null;

    FIG_FIELDS.forEach((f) => {
      const m = fields[f.key];
      if (!m) return;
      const col = typeof m === 'string' ? m : m.column;
      const sep = typeof m === 'string' ? ';' : (m.separator || ';');
      if (!col) return;
      const raw = row[col];
      if (raw == null || String(raw).trim() === '') return;
      const val = String(raw).trim();
      if (f.key === 'files') { fileNames = splitList(val, sep); return; }
      if (f.key === 'articleId') { articleId = val; return; }
      switch (f.type) {
        case 'string': meta[f.key] = val; break;
        case 'int':
          if (f.resolve) { const r = resolveId(val, f.resolve, opts.lookups); if (r != null) meta[f.key] = r; }
          else { const n = parseInt(val, 10); if (!isNaN(n)) meta[f.key] = n; }
          break;
        case 'list': meta[f.key] = splitList(val, sep); break;
        case 'authors': meta[f.key] = splitList(val, sep).map(toAuthor); break;
        case 'intlist':
          meta[f.key] = splitList(val, sep).map((x) => resolveId(x, f.resolve, opts.lookups)).filter((x) => x != null);
          break;
      }
    });

    const cf = mapping.customFields || {};
    const customOut = {};
    Object.keys(cf).forEach((name) => {
      const m = cf[name];
      const col = typeof m === 'string' ? m : m.column;
      if (!col) return;
      const raw = row[col];
      if (raw == null || String(raw).trim() === '') return;
      const val = String(raw).trim();
      customOut[name] = (m && m.list) ? splitList(val, m.separator || ';') : val;
    });
    if (Object.keys(customOut).length) meta.custom_fields = customOut;

    if (defaults.categories && defaults.categories.length && !(meta.categories && meta.categories.length)) meta.categories = defaults.categories.slice();
    if (defaults.license != null && meta.license == null) meta.license = defaults.license;
    if (defaults.defined_type && !meta.defined_type) meta.defined_type = defaults.defined_type;
    if (defaults.group_id != null && meta.group_id == null) meta.group_id = defaults.group_id;
    if (defaults.keywords && defaults.keywords.length) meta.keywords = Array.from(new Set([].concat(meta.keywords || [], defaults.keywords)));

    return { meta, fileNames, articleId };
  }

  function autoMatch(headers) {
    const norm = (s) => String(s).toLowerCase().replace(/[\s_\-]+/g, ' ').trim();
    const cols = headers.map((h) => ({ raw: h, n: norm(h) }));
    const fields = {};
    FIG_FIELDS.forEach((f) => {
      const hit = cols.find((c) => f.syn.includes(c.n)) || cols.find((c) => f.syn.some((s) => c.n.includes(s)));
      if (hit) fields[f.key] = (f.type === 'list' || f.type === 'intlist' || f.type === 'authors') ? { column: hit.raw, separator: ';' } : hit.raw;
    });
    return fields;
  }

  /**
   * Pre-flight: validate every row before any upload.
   * ctx = { operation, sync, mode, publish, lookups, existing:[{id,title}], fileSet:Set(lowercase basenames) }
   * returns { rows:[{i,row,title,severity,bucket,isDup,dupOf,issues}], counts, blocking }
   */
  function preflight(rows, mapping, ctx) {
    ctx = ctx || {};
    const op = ctx.operation || 'create';
    const sync = ctx.sync || 'create';
    const mode = ctx.mode || 'metadata';
    const publish = !!ctx.publish;
    const lookups = ctx.lookups || null;
    const catIds = new Set((lookups && lookups.categories || []).map((c) => c.id));
    const licIds = new Set((lookups && lookups.licenses || []).map((l) => (l.value !== undefined ? l.value : l.id)));
    const fileSet = ctx.fileSet || null;
    const needsId = ['update', 'addfiles', 'publish', 'delete'].includes(op);

    const existLower = new Map(), existNorm = new Map();
    (ctx.existing || []).forEach((a) => {
      if (!a.title) return;
      const tl = String(a.title).trim().toLowerCase();
      if (!existLower.has(tl)) existLower.set(tl, a.id);
      const tn = normTitle(a.title);
      if (!existNorm.has(tn)) existNorm.set(tn, a.id);
    });

    const seen = new Map();
    const rank = { ok: 0, warn: 1, error: 2 };
    const out = rows.map((row, i) => {
      const b = buildRow(row, mapping, { lookups });
      const title = b.meta.title || '';
      const tl = title.trim().toLowerCase();
      const tn = normTitle(title);
      const issues = [];
      let sev = 'ok', isDup = false, dupOf = null;
      const bump = (s) => { if (rank[s] > rank[sev]) sev = s; };

      if (op === 'create') {
        if (!title) { issues.push('Missing title'); bump('error'); }
        else if (title.length < 3) { issues.push('Title too short (Figshare needs 3+ characters)'); bump('error'); }
      }
      if (needsId) {
        const matched = b.articleId || existLower.get(tl);
        if (!matched) { issues.push('No Article ID and no matching title on Figshare'); bump('error'); }
        else if (!b.articleId) { issues.push('Matched existing by title (ID ' + matched + ')'); }
      }
      if (tn) {
        if (seen.has(tn)) { isDup = true; dupOf = 'row ' + (seen.get(tn) + 1); issues.push('Duplicate of row ' + (seen.get(tn) + 1) + ' in this sheet'); }
        else seen.set(tn, i);
      }
      if (op === 'create') {
        const exId = existLower.get(tl) || existNorm.get(tn);
        if (exId) {
          isDup = true; dupOf = dupOf || ('fig:' + exId);
          const fate = sync === 'skip' ? 'will be skipped' : sync === 'update' ? 'will update it' : 'WILL CREATE A DUPLICATE';
          issues.push('Already on Figshare (ID ' + exId + ') — ' + fate);
          if (sync === 'create') bump('warn');
        }
      }
      (b.meta.categories || []).forEach((id) => { if (catIds.size && !catIds.has(id)) { issues.push('Unknown category ID ' + id); bump('warn'); } });
      if (licIds.size && b.meta.license != null && !licIds.has(b.meta.license)) { issues.push('Unknown licence ID ' + b.meta.license); bump('warn'); }
      if (b.meta.defined_type && !ITEM_TYPES.includes(String(b.meta.defined_type).toLowerCase())) { issues.push('Unusual item type "' + b.meta.defined_type + '"'); bump('warn'); }
      if (mode === 'files' || op === 'addfiles') {
        if (!b.fileNames.length) { issues.push('No file referenced'); bump('warn'); }
        b.fileNames.forEach((n) => { if (fileSet && !fileSet.has(baseName(n).toLowerCase())) { issues.push('File not available: ' + baseName(n)); bump('error'); } });
      }
      if (publish && (op === 'create' || op === 'update') && !(b.meta.categories && b.meta.categories.length)) {
        issues.push('Publishing usually requires at least one category'); bump('warn');
      }

      const bucket = sev === 'error' ? 'error' : (isDup ? 'dup' : (sev === 'warn' ? 'warn' : 'ok'));
      return { i, row: i + 1, title, severity: sev, bucket, isDup, dupOf, issues };
    });

    const counts = { total: out.length, ok: 0, warn: 0, error: 0, dup: 0 };
    out.forEach((r) => { counts[r.bucket]++; });
    return { rows: out, counts, blocking: counts.error > 0 };
  }

  return { FIG_FIELDS, ITEM_TYPES, splitList, baseName, normTitle, toAuthor, resolveId, buildRow, autoMatch, preflight };
});
