# Changelog

All notable changes to this project. Releases are published at
https://github.com/zmobariz/bulk-uploader-for-figshare/releases

## 2.2.0 — security hardening + platform upgrade
Change record: [CR-2026-11-23-01](docs/CHANGE-CONTROL.md#cr-2026-11-23-01).

**Application security fixes**
- **Fixed reflected XSS in the results table.** A spreadsheet "Article ID" cell such as `1<img src=x onerror=…>` was echoed back by the server and rendered as HTML (most directly with *Add files* and no attachments). Article IDs are now validated as positive integers for every operation that uses one, in both the web app and the CLI. *Create* ignores the column, so an auto-mapped "Identifier" column doesn't block a create batch. Pre-flight flags a non-numeric ID before anything is sent. Every server- or Figshare-supplied value in the results (ID, DOI, warnings, links) is HTML-escaped, and links are only rendered for `https://*.figshare.com` / `*.figsh.com` URLs.
- Category IDs from an imported mapping file are escaped (a shared mapping could otherwise insert markup).
- **Results CSV (web and CLI): formula injection neutralised.** Cells starting with `=`, `+`, `-`, `@`, tab or CR are prefixed with `'`, so a title like `=HYPERLINK(…)` stays text in Excel or LibreOffice.
- **Content-Security-Policy** on every response: scripts only from the app itself (no inline script, no `eval`), `connect-src 'self'` (blocks exfiltration even if markup were injected), no framing, no plugins. Also `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, COOP/CORP, a restrictive `Permissions-Policy`; `X-Powered-By` removed.
- **DNS-rebinding defence:** requests whose `Host` header is not a loopback name are refused (HTTP 421). Hosted/Docker deployments reached by another name set `ALLOWED_HOSTS` (see README → Configuration).
- **Cross-site request defence:** state-changing requests from another origin are refused (HTTP 403), so a web page can no longer drive the local API with form posts. The check uses `Origin` (scheme, host and port) and `Sec-Fetch-Site`. Behind a reverse proxy, set `TRUST_PROXY=1`: `X-Forwarded-Host` / `X-Forwarded-Proto` then supply the one host used for both the allow-list and the Origin check. They are ignored otherwise.
- **Uploads:**
  - Temp files go in a private per-process directory, created `0700` and removed on exit.
  - Files get random names, so the client file name never reaches the filesystem.
  - Every temp file is removed on every path, including a write error part-way through.
  - A single non-empty token must arrive before any file is written.
  - At most 500 files per request; pre-flight flags rows with more.
- Errors return generic JSON instead of an HTML stack trace. Malformed multipart bodies and other input errors return 400 (not 500/502). `/api/lookups` errors are handled.
- Results CSV also quotes `;` and tab, so European-locale Excel (which splits on `;`) cannot expose an unchecked formula cell.
- A port already in use now fails with a clear error instead of being ignored.

**Desktop (Electron) hardening**
- Renderer explicitly sandboxed (`sandbox`, `contextIsolation`, no Node integration, no `<webview>`).
- `window.open` / `target=_blank` links open in the system browser (https only) and never as an in-app window; the app window cannot navigate or redirect away from its own UI.
- All permission requests (camera, microphone, location, HID/USB/serial, notifications…) are denied.
- Updater IPC is accepted only from the app's own top-level page.
- **Auto-update no longer installs silently on quit:** a downloaded update is applied only when the user clicks *Restart to update*, matching the assurance statement.
- The local server binds an OS-assigned port that the app itself owns. Previously the app picked a free port, released it, then bound it, so another process could take the port in between and receive the user's token. The server is started once, and reopening the window on macOS reuses it instead of pointing at an unused port. Electron's own quit lifecycle handles signals.
- Desktop packages contain only the runtime files (no tests, docs, Dockerfile or CI config).

**Platform & dependencies** — `npm audit`: 0 vulnerabilities
- Electron 43 → **45.4.1** (current Chromium/Node runtime in the desktop apps); electron-builder 26.18.0; electron-updater 6.8.11; Express 5.3.0; multer 2.5.0. SheetJS 0.20.3 is already the latest release.
- Clears all 34 open Dependabot alerts (proxy-addr 2.0.8 *critical*; undici 6.29.1 / 7.30.2; body-parser 2.4.0; fast-uri 3.1.9; multer 2.5.0; Electron) plus `npm audit`-only advisories (qs, glob, brace-expansion, minimatch).
- Overrides reduced to `@electron/asar ^4.3.2` and `minimatch ^11.0.1` (the `tar` override is no longer needed).
- Docker base image `node:22-alpine` → **`node:26-alpine`** (current LTS, digest-pinned); the image now installs with `npm ci` (exactly the lockfile).

**Build, release & CI**
- Release workflow on Node 26 and `npm ci`; GitHub Actions updated to current pinned SHAs (setup-node 7.1.0, upload-artifact 7.0.2, download-artifact 8.0.2, CodeQL 4.39.4, Scorecard 2.6.0, cosign-installer 4.1.3).
- **Release signing format changed:** cosign v3 signs `SHA256SUMS.txt` as a Sigstore bundle, **`SHA256SUMS.txt.sigstore.json`** (replacing `.sig` + `.pem`). Verification steps in `ASSURANCE.md` now pin the release workflow identity.
- Dependabot groups GitHub Actions updates (CodeQL `init`/`analyze` must move together).
- New automated test suite (`npm test`, Node's built-in runner, offline). Its 28 tests cover the CSP and headers, Host and Origin checks (including trusted-proxy scenarios), the SSRF allow-list, Article ID validation and pre-flight, upload temp-file handling and error responses. A new Test workflow runs it on Node 22 and 26 with `npm audit` and a Docker build on every pull request.

## 2.1.3 — security (dependencies)
- multer 2.2.0 → 2.3.0 (runtime): fixes a file-descriptor leak on aborted uploads (GHSA-qfvm-cv95-jqjf) plus GHSA-wc9g-mqfw-jrwm, GHSA-qvfw-j98x-7q72 and GHSA-535w-7cp7-47q4; minimum range raised to `^2.3.0`.
- qs 6.15.3 → 6.16.0 (runtime, via Express): GHSA-x5fp-wj9c-mxmx, GHSA-4mjr-xmp4-gh2g.
- js-yaml 4.3.1 → 4.3.2 (runtime via electron-updater, and the dev tree): GHSA-2883-xcg3-v3hh.
- Dev-tree dependency security fixes: fast-uri 3.1.7, @xmldom/xmldom 0.8.15 — `npm audit` clean.
- CI: GitHub Actions updated — checkout v7.0.1 (incl. the release workflow), CodeQL v4.38.0, OpenSSF Scorecard v2.4.4 (image moved from gcr.io to ghcr.io, fixing the Scorecard workflow).

## 2.1.2 — security (dependencies + runtime)
- Electron 42 → 43 (patched Chromium and Node runtime shipped in the desktop apps).
- Dev-tree dependency security fixes: undici (both 6.x and 7.x copies), fast-uri, brace-expansion, js-yaml — `npm audit` clean.
- Docker base image `node:20-alpine` → `node:22-alpine` (LTS, digest-pinned).
- CI: GitHub Actions (checkout, setup-node, upload/download-artifact, CodeQL) updated to current majors.

## 2.1.1 — security (build toolchain)
- Cleared 18 `npm audit` findings in the electron-builder dev tree via `tar` 7.5.22, `@electron/asar` 4 and `minimatch` 10 overrides.
- Release workflow bumped to Node 22.

## 2.1.0 — rebrand + update notifications
- Renamed to **Bulk Uploader for Figshare** (repo `bulk-uploader-for-figshare`) — a third-party app *for* Figshare, not affiliated with Figshare.
- In-app **About** footer showing the version with links to the GitHub repo and Releases.
- **Update notifications:** checks the GitHub Releases API and flags when a newer version exists (opt-out: `NO_UPDATE_CHECK=1`).
- **Desktop auto-update:** the Windows per-user installer and Linux AppImage download updates in the background and prompt before installing; the portable .exe and unsigned macOS build fall back to a download notification.
- Docs/assurance updated to disclose the optional GitHub connection and the opt-out.

## 2.0.6
- `HOST` is now configurable (defaults to loopback `127.0.0.1`; the Docker image binds `0.0.0.0`), fixing container port-mapping.
- Documentation: corrected `localhost`/`127.0.0.1` references, refreshed project layout, added `SECURITY.md` and this changelog.

## 2.0.4 – 2.0.5 — security (CodeQL)
- Removed a ReDoS-prone regex (non-backtracking trailing-slash strip).
- Added an HTTPS Figshare-host allow-list enforced on every outbound request (SSRF defence) and bound the local server to loopback only.

## 2.0.3 — security (Dependabot)
- Electron 31 → 42 (patched Chromium), electron-builder 24 → 26, pinned `tar` 7.5.16. `npm audit` clean.

## 2.0.2 — packaging
- Cross-platform desktop apps (Windows portable + per-user installer, macOS `.dmg`, Linux AppImage) built in GitHub Actions with SHA-256 checksums.
- Bundled SheetJS locally — no CDN call at runtime (offline/locked-down friendly).

## 2.0.0 — v2
- Pre-flight duplicate check; operations create/update/publish/delete/add-files; visual column mapper; headless CLI; Docker.
