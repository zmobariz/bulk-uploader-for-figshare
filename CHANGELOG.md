# Changelog

All notable changes to this project. Releases are published at
https://github.com/zmobariz/bulk-uploader-for-figshare/releases

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
