# Figshare Bulk Uploader

A modern, browser-based replacement for the old desktop
[`amoe/figshare-uploader`](https://github.com/amoe/figshare-uploader) — plus a headless CLI.
Drop in a spreadsheet, map columns once, and create, update, publish or clean up many
Figshare articles in a single run.

> Unofficial tool. Not affiliated with or endorsed by Figshare.

---

## Highlights (v2)

**Reliability**
- **Pre-flight check** — a visual report flagging duplicates (within your sheet and already on Figshare), invalid category/licence IDs, unmatched files and missing IDs, before anything is created.
- Sync / de-dup on re-run — match on Title and *skip* or *update* instead of creating duplicates.
- Retry only the failed rows in one click.
- Large-file uploads resume automatically (skip already-completed parts) and retry parts on network blips.
- Configurable parallelism with automatic backoff on rate limits (HTTP 429) and 5xx.

**More than create**
- Operations: **create**, **update** (metadata/files), **add files**, **publish**, **delete** (guarded).
- Update/publish/delete target rows by an *Article ID* column or by Title match.

**Richer, correct metadata**
- Searchable category & licence pickers — choose by name, the app fills the numeric ID.
- Per-row category/licence by name too (resolved against the live lists).
- Custom fields (institutional accounts).
- Authors auto-detected as ORCID, numeric author ID, or plain name.
- Reserve a DOI and set an embargo as part of the run.
- Batch defaults applied to every row that doesn't set its own.

**Workflow & record-keeping**
- Saved mapping templates + remembered settings (token never stored).
- Full per-row payload preview before anything is sent.
- Multi-sheet workbook support (pick the worksheet).
- Export a results CSV, or download a copy of your sheet with new **ID / DOI / URL / status** columns appended.

**Run it your way**
- Web app (local Node server), headless **CLI**, **Docker**, or an optional **Electron** desktop window.

## Why there's a server

Figshare's upload service needs an MD5 hash and chunked part uploads to a separate host
that browsers can't call directly (CORS). The Node server does that orchestration and
proxies the API. Your token is sent per request and is never written to disk or logged.

---

## Quick start (web app)

Requires [Node.js 18+](https://nodejs.org/).

```bash
npm install
npm start
```

Open **http://localhost:4000** (use `localhost`, not `127.0.0.1`).

Flow: connect → load spreadsheet → pick operation & options → (map columns, auto-matched on load) → validate → run. Watch per-row progress, retry failures, export the audit trail.

## CLI (automation / CI)

```bash
# dry run — builds and prints payloads, creates nothing
node cli.js --token "$FIGSHARE_TOKEN" --file samples/sample_metadata_template.csv \
  --config samples/sample_mapping.json --dry-run

# create as drafts, with files, 3 in parallel, write an audit CSV
node cli.js --token "$FIGSHARE_TOKEN" --file data.xlsx --config mapping.json \
  --mode files --files-dir ./files --concurrency 3 --out results.csv

# re-run safely: update existing items matched by title instead of duplicating
node cli.js --token "$FIGSHARE_TOKEN" --file data.xlsx --config mapping.json --sync update

# pre-flight only: report duplicates and problems, upload nothing
node cli.js --token "$FIGSHARE_TOKEN" --file data.xlsx --config mapping.json --preflight
```

Run `node cli.js --help` for all flags. `--config` is the JSON exported from the web app's mapper.

## Docker

```bash
npm run docker:build
npm run docker:run        # serves on http://localhost:4000
```

## Desktop (optional, Electron)

Electron is heavy, so it isn't a default dependency:

```bash
npm install --save-dev electron
npm run desktop
```

For installers, add `electron-builder` and run `npx electron-builder`.

---

## The spreadsheet & mapping

First row = headers; each row below = one article. You map your column names to Figshare
fields in the app (auto-matched on load). Start from `samples/sample_metadata_template.csv`
or `.xlsx`. Mapping/config JSON shape:

```json
{
  "version": 2,
  "mapping": {
    "fields": {
      "title": "Title",
      "keywords": { "column": "Keywords", "separator": ";" },
      "authors": { "column": "Authors", "separator": ";" },
      "articleId": "Article ID"
    },
    "customFields": { "Department": { "column": "Dept", "list": false } },
    "defaults": { "categories": [1], "license": 1, "defined_type": "dataset" }
  },
  "options": { "operation": "create", "sync": "update", "mode": "files", "concurrency": 3 }
}
```

Fields: `title` (required for create), `description`, `keywords`, `categories`
(IDs or names), `authors` (name / ORCID / ID), `references`, `license` (ID or name),
`defined_type`, `funding`, `group_id`, plus `articleId` and `files` (used for matching /
attaching, not sent as metadata).

---

## Notes & limits

- **Unpublish isn't offered** — Figshare's public API has no endpoint to revert a published item, so the tool doesn't fake one.
- **Delete** only works on drafts/private items and is gated behind an explicit confirmation.
- **Publishing mints public DOIs** — validate first; keep the default *Draft* until confident.
- Sequential safety: parallelism is capped (default 2) and backs off on rate limits.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `4000` | Server port. |
| `FIGSHARE_TOKEN` | — | CLI token (alternative to `--token`). |
| `FIGSHARE_BASE` | api.figshare.com/v2 | CLI base URL. |

## Project layout

```
server.js          Express server (thin) -> lib/figshare.js
cli.js             Headless CLI
lib/figshare.js    API core: retry/backoff, resumable upload, runOperation()
public/
  index.html       UI
  styles.css       Styling (light + dark)
  app.js           UI logic
  shared.js        Mapping/metadata building (shared by browser + CLI)
samples/           Example template + mapping
Dockerfile         Container image
electron/main.js   Optional desktop wrapper
```

## License

Apache-2.0, in keeping with the original project.
