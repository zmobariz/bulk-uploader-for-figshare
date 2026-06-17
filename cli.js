#!/usr/bin/env node
/**
 * cli.js — headless bulk uploader for CI / automation.
 *
 *   node cli.js --token <T> --file data.xlsx --config mapping.json [options]
 *
 * Options:
 *   --token <t>          Figshare personal token   (or env FIGSHARE_TOKEN)
 *   --base <url>         API base (default https://api.figshare.com/v2)
 *   --file <path>        .xlsx / .xls / .csv (one row per article)   [required]
 *   --sheet <name>       worksheet name (default: first sheet)
 *   --config <path>      JSON: { mapping, defaults, customFields, options }
 *   --operation <op>     create | update | publish | delete | addfiles
 *   --sync <mode>        create | skip | update   (de-dup for 'create')
 *   --mode <mode>        metadata | files
 *   --files-dir <dir>    folder holding files referenced in the sheet
 *   --concurrency <n>    parallel rows (default 2)
 *   --publish            publish created/updated articles
 *   --reserve-doi        reserve a DOI
 *   --preflight          validate everything (incl. duplicates) and exit; no uploads
 *   --dry-run            build + print payloads offline; no network, no uploads
 *   --out <path>         write a results CSV
 *   --help
 */
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const fig = require('./lib/figshare');
const FigMapping = require('./public/shared.js');

function parseArgs(argv) {
  const a = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t.startsWith('--')) {
      const k = t.slice(2);
      const flags = ['publish', 'reserve-doi', 'preflight', 'dry-run', 'help'];
      if (flags.includes(k)) a[k] = true;
      else { a[k] = argv[++i]; }
    } else a._.push(t);
  }
  return a;
}

const HELP = fs.readFileSync(__filename, 'utf8').split('\n').filter((l) => l.startsWith(' *')).map((l) => l.slice(3)).join('\n');

async function pool(items, n, worker) {
  const results = new Array(items.length);
  let i = 0;
  const runners = Array.from({ length: Math.max(1, n) }, async () => {
    while (i < items.length) { const idx = i++; results[idx] = await worker(items[idx], idx); }
  });
  await Promise.all(runners);
  return results;
}

function csvCell(s) { const v = String(s == null ? '' : s).replace(/"/g, '""'); return /[",\n]/.test(v) ? `"${v}"` : v; }

(async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || (!args.file && !args._.length)) { console.log(HELP); process.exit(args.help ? 0 : 1); }

  const token = args.token || process.env.FIGSHARE_TOKEN;
  if (!token && !args['dry-run']) { console.error('Error: --token (or FIGSHARE_TOKEN) is required.'); process.exit(1); }
  const base = args.base || process.env.FIGSHARE_BASE || fig.DEFAULT_BASE;
  const filePath = args.file || args._[0];
  if (!filePath || !fs.existsSync(filePath)) { console.error('Error: --file not found: ' + filePath); process.exit(1); }

  const config = args.config ? JSON.parse(fs.readFileSync(args.config, 'utf8')) : {};
  const mapping = {
    fields: (config.mapping && config.mapping.fields) || config.mapping || {},
    customFields: config.customFields || (config.mapping && config.mapping.customFields) || {},
    defaults: config.defaults || (config.mapping && config.mapping.defaults) || {},
  };
  const opt = config.options || {};
  const operation = args.operation || opt.operation || 'create';
  const sync = args.sync || opt.sync || 'create';
  const mode = args.mode || opt.mode || 'metadata';
  const publish = args.publish || !!opt.publish;
  const reserveDoi = args['reserve-doi'] || !!opt.reserveDoi;
  const embargo = opt.embargo || null;
  const concurrency = parseInt(args.concurrency || opt.concurrency || 2, 10);

  const wb = XLSX.readFile(filePath);
  const sheet = args.sheet || wb.SheetNames[0];
  const ws = wb.Sheets[sheet];
  if (!ws) { console.error('Error: sheet not found: ' + sheet); process.exit(1); }
  const rows = XLSX.utils.sheet_to_json(ws, { defval: '', raw: false });
  console.log(`Loaded ${rows.length} row(s) from "${sheet}".`);

  if (!Object.keys(mapping.fields).length) {
    const headers = (XLSX.utils.sheet_to_json(ws, { header: 1 })[0] || []).map(String);
    mapping.fields = FigMapping.autoMatch(headers);
    console.log('No mapping supplied — auto-matched columns:', Object.keys(mapping.fields).join(', '));
  }

  // dry run: build offline and print, no network calls
  if (args['dry-run']) {
    const built0 = rows.map((row) => FigMapping.buildRow(row, mapping, { lookups: null }));
    built0.forEach((b, i) => {
      console.log(`\n--- row ${i + 1} (${operation}) ---`);
      console.log(JSON.stringify(b.meta, null, 2));
      if (b.fileNames.length) console.log('files:', b.fileNames.join(', '));
    });
    console.log(`\nDry run complete: ${built0.length} row(s), nothing was created.`);
    process.exit(0);
  }

  // lookups for name->ID resolution + duplicate detection
  let lookups = null;
  try { const [categories, licenses] = await Promise.all([fig.getCategories(base, token), fig.getLicenses(base, token)]); lookups = { categories, licenses }; } catch (e) { /* ignore */ }

  // pre-flight: validate (incl. duplicates) and exit, no uploads
  if (args['preflight']) {
    let existing = [];
    try { existing = await fig.listAllArticles(base, token); } catch (e) { console.warn('Could not list existing articles: ' + e.message); }
    let fileSet = null;
    if ((mode === 'files' || operation === 'addfiles') && args['files-dir']) fileSet = new Set(fs.readdirSync(args['files-dir']).map((n) => n.toLowerCase()));
    const rep = FigMapping.preflight(rows, mapping, { operation, sync, mode, publish, lookups, existing, fileSet });
    const c = rep.counts;
    console.log(`\nPre-flight: ${c.total} rows — ${c.ok} ready, ${c.dup} duplicate, ${c.warn} warning, ${c.error} error`);
    rep.rows.filter((r) => r.bucket !== 'ok').forEach((r) => console.log(`  row ${r.row} [${r.bucket.toUpperCase()}] ${r.title || '(no title)'}: ${r.issues.join('; ')}`));
    console.log(rep.blocking ? '\nBLOCKED: fix errors before uploading.' : '\nCleared for upload.');
    process.exit(rep.blocking ? 2 : 0);
  }

  // de-dup / update-by-title
  let titleMap = new Map();
  if (sync !== 'create' || operation === 'update') {
    try {
      const existing = await fig.listAllArticles(base, token);
      existing.forEach((a) => { if (a.title) titleMap.set(String(a.title).trim().toLowerCase(), String(a.id)); });
      console.log(`Fetched ${existing.length} existing article(s) for matching.`);
    } catch (e) { console.warn('Could not list existing articles: ' + e.message); }
  }

  // files index
  let fileIndex = new Map();
  if ((mode === 'files' || operation === 'addfiles') && args['files-dir']) {
    for (const name of fs.readdirSync(args['files-dir'])) fileIndex.set(name.toLowerCase(), path.join(args['files-dir'], name));
  }

  const built = rows.map((row) => FigMapping.buildRow(row, mapping, { lookups }));

  let done = 0, errors = 0, skipped = 0;
  const results = await pool(built, concurrency, async (b, i) => {
    let op = operation, articleId = b.articleId;
    if (operation === 'create') {
      const existingId = b.meta.title ? titleMap.get(String(b.meta.title).trim().toLowerCase()) : null;
      if (existingId && sync === 'skip') { skipped++; console.log(`row ${i + 1}: SKIP (exists ${existingId})`); return { row: i + 1, title: b.meta.title, status: 'skipped', articleId: existingId }; }
      if (existingId && sync === 'update') { op = 'update'; articleId = existingId; }
    } else if (operation === 'update' && !articleId && b.meta.title) {
      articleId = titleMap.get(String(b.meta.title).trim().toLowerCase());
    }
    const files = (mode === 'files' || op === 'addfiles')
      ? b.fileNames.map((n) => fileIndex.get(FigMapping.baseName(n).toLowerCase())).filter(Boolean).map((p) => ({ path: p, name: path.basename(p) }))
      : [];
    try {
      const r = await fig.runOperation({ base, token, operation: op, mode, publish, reserveDoi, embargo, metadata: b.meta, articleId, files });
      done++;
      const url = r.publishedUrl || (r.articleId ? `https://figshare.com/account/articles/${r.articleId}` : '');
      console.log(`row ${i + 1}: ${r.action} ${r.articleId || ''} ${r.doi ? '(' + r.doi + ')' : ''}`);
      return { row: i + 1, title: b.meta.title || '', status: r.action, articleId: r.articleId || '', doi: r.doi || '', url, files: r.uploaded.length, warnings: (r.warnings || []).join('; ') };
    } catch (e) {
      errors++;
      console.error(`row ${i + 1}: ERROR ${e.message}`);
      return { row: i + 1, title: b.meta.title || '', status: 'error', error: e.message };
    }
  });

  if (args.out) {
    const head = ['row', 'title', 'status', 'articleId', 'doi', 'url', 'files', 'error', 'warnings'];
    const lines = [head.join(',')].concat(results.map((r) => head.map((h) => csvCell(r[h])).join(',')));
    fs.writeFileSync(args.out, lines.join('\n'));
    console.log(`\nResults written to ${args.out}`);
  }
  console.log(`\nDone: ${done} ok, ${skipped} skipped, ${errors} failed.`);
  process.exit(errors ? 2 : 0);
})().catch((e) => { console.error('Fatal:', e.message); process.exit(1); });
