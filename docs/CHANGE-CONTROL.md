# Change control register

Every release of **Bulk Uploader for Figshare** is recorded here: what changed, why, the risk, how it
was tested, how to roll it back, and who approved it. Institutions can cite these records in their
own change-approval process. The user-facing summary of each release is in
[CHANGELOG.md](../CHANGELOG.md); releases before v2.2.0 are recorded there only.

**Process**
1. Every change lands through a pull request against `main`. The Test (`npm ci`, `npm audit`,
   `npm test`, Docker build) and CodeQL checks must pass.
2. A release is a version bump plus a change record in this file, in the same pull request.
3. Before merging, the desktop builds are run through the release workflow (`workflow_dispatch`, no
   publishing) on the release branch for Windows, macOS and Linux.
4. After merge, a `vX.Y.Z` tag triggers the release workflow. It builds all platforms from the tagged
   source, writes `SHA256SUMS.txt` and signs it with Sigstore cosign.
5. Post-release checks (below) are recorded against the change.

Change types: **Standard** (pre-approved, low risk: docs, dependency patch bumps with no behaviour
change), **Normal** (anything that changes behaviour, security posture or the platform), and
**Emergency** (actively exploited issue; the record may be completed after release).

---

## CR-2026-11-23-01

| Field | Value |
| --- | --- |
| Title | Security hardening and platform upgrade (v2.2.0) |
| Type | Normal (security) |
| Version | 2.1.3 → **2.2.0** |
| Requested / approved by | Repository owner (zmobariz), 23 Nov 2026 |
| Pull requests | #59 (Dependabot alert fixes, merged), #60 (this release) |
| Status | Approved; implemented on merge of #60 and tag `v2.2.0` |

### Reason
- 34 open Dependabot alerts (1 critical, 15 high) across Electron, undici, multer, body-parser,
  proxy-addr and fast-uri.
- A security review of the application found a reflected-XSS path, no Content-Security-Policy, no
  protection against DNS rebinding or cross-site requests against the local server, an Electron
  window with no navigation or permission policy, and auto-update behaviour (silent install on quit)
  that contradicted the assurance statement.
- The release toolchain had to move to cosign v3, which no longer produces the `.sig`/`.pem` pair.

### Scope
| Area | Change |
| --- | --- |
| Server (`server.js`, new `lib/guard.js`) | CSP and security headers; Host allow-list; cross-origin refusal (scheme, host, port; one effective host behind a proxy, `TRUST_PROXY=1`); private per-process `0700` temp dir; random temp names, tracked and removed on every path; single non-empty token required before any file is written; 500-file cap; generic JSON errors (input errors → 400); `start()` binds an OS-assigned port; signal handlers only when standalone |
| API core (`lib/figshare.js`) | Article ID must be a positive integer for update, publish, delete and add-files (shared by the web app and CLI); *Create* ignores a supplied ID |
| UI (`public/app.js`, `public/shared.js`) | Escape every server/Figshare value in results and imported-mapping category IDs; only link to `https://*.figshare.com` / `*.figsh.com`; update banner only links to `https://github.com/`; pre-flight flags non-numeric IDs; results CSV neutralises formulas |
| CLI (`cli.js`) | Results CSV neutralises formulas |
| Desktop (`electron/main.js`, `electron-builder.yml`) | Explicit sandbox and context isolation; deny `window.open`, navigation, redirects and `<webview>`; deny all permissions; check the IPC sender; no silent install on quit; in-process server on a port it owns (removes a port-takeover race), started once (macOS reopen fix); package only runtime files |
| Dependencies | Electron 45.4.1, electron-builder 26.18.0, electron-updater 6.8.11, Express 5.3.0, multer 2.5.0; `npm audit` 0 |
| Container | `node:26-alpine` (digest-pinned), `npm ci --omit=dev` |
| CI / release | Node 26; `npm ci`; Actions updated (pinned SHAs); cosign v3 Sigstore bundle; new Test workflow; Dependabot groups Actions updates |
| Docs | CHANGELOG, README, ASSURANCE, SECURITY, DEPLOYMENT-AND-SECURITY, this register |

### Risk and impact
| Change | Who is affected | Risk | Mitigation |
| --- | --- | --- | --- |
| Host allow-list (HTTP 421 for non-loopback `Host`) | Docker or server deployments reached by a hostname or LAN IP | Medium: those deployments stop answering until configured | Set `ALLOWED_HOSTS` (documented in README and the deployment notes). Desktop and `localhost` use are unaffected |
| Cross-origin refusal (HTTP 403) | Anyone calling the API from another web origin; reverse-proxy deployments | Low: calling the API from another web origin is not a supported use. A proxied deployment sets `TRUST_PROXY=1` and forwards `X-Forwarded-Host` / `X-Forwarded-Proto` (Caddy/Traefik defaults, two lines for nginx) | Documented in README and the deployment notes; covered by tests |
| Article ID must be a positive integer (update/publish/delete/add-files) | Spreadsheets with malformed IDs | Low: Figshare IDs are integers. Pre-flight now flags the row before anything is sent; *Create* ignores the column | Clear error text; tests |
| Token required before files; 500-file cap | Clients that send files before the token field | Low: the bundled UI already sends the token first | None needed |
| No install on quit | Windows installer and AppImage users | Low: updates apply only after *Restart to update* | Banner remains; matches the assurance statement |
| Electron 43 → 45 | All desktop users | Medium: two Chromium/Node majors | Electron smoke and UI-flow tests (below); CI builds for all three OSes before merge |
| cosign bundle format | People who verify release signatures | Low | ASSURANCE.md documents both the new and the old verification commands |
| Node 26 base image / CI | Docker users, release builds | Low: current LTS; tests pass on 22 and 26 | Matrix CI on 22 and 26 |

### Test evidence (23 Nov 2026)
- **Dependencies:** `npm audit` reports 0 vulnerabilities; `npm ci` passes on npm 10 (Node 22) and
  npm 11 (Node 26).
- **Automated suite** (`npm test`): 29/29 pass on Node 22 and Node 26, locally and in the Test
  workflow. An earlier 17-test version of the suite, run against the previous code, failed 5 tests
  (CSP, Host check, cross-origin, Article ID, stack-trace error), which shows it detects the
  issues it guards against.
- **Independent review:** a second, independent AI code review (OpenAI Codex) of the branch diff
  raised 12 findings.
  - 11 were confirmed and fixed in this change: a Create-batch regression from the new Article ID
    check; reverse-proxy origin handling; Origin scheme; shared temp-dir permissions; partial-file
    cleanup; files written before token validation; macOS window reopen; error status codes;
    mapping-import escaping; CSV formula injection; staging (`figsh.com`) links.
  - 1 is accepted as residual risk (below).
  - **Round 2** re-reviewed the fix commit and raised 7 findings plus 6 edge cases. All were
    confirmed and fixed:
    - a pre-existing pick-then-bind port race (another process could take the desktop app's port);
    - a health-probe hang;
    - proxy host and port handling, now one trusted effective host;
    - whitespace or repeated token fields;
    - CSV splitting on `;`;
    - signal handling inside Electron;
    - the edge cases: a file-count pre-flight check, a missing `TMPDIR`, input-error status
      codes, path matching, a double unlink, and test teardown.
  - **Round 3** re-reviewed that commit. It found no new bypass, and 5 edge-case regressions in
    round-2 changes, all fixed:
    - a bare forwarded host acted as "any port";
    - the file cap blocked rows that would be skipped, and applied to the CLI, which has no such
      limit;
    - quoting `;` in the CSV broke semicolon-delimited re-import, so it was reverted (see
      residual risk);
    - the tests inherited proxy settings from the environment.
- **Desktop security smoke** (Electron 45.4.1, driven over the DevTools protocol): 18/18 pass. The
  same 18 checks and the 10 UI-flow checks also pass against the **CI-built Linux AppImage**
  (extracted; its SHA-512 matches `latest-linux.yml`) and against the trimmed local package.
  - Renderer has no `require`/`process`; only the preload bridge is exposed.
  - SheetJS loads and parses the sample workbook under the CSP.
  - Injected inline `<script>` and `onerror=` handlers are blocked; `fetch` to another origin is blocked.
  - `window.open` returns `null` and creates no window; navigating away is blocked.
  - Geolocation and microphone requests are denied.
  - No CSP violations from the app itself and no renderer exceptions.
- **Desktop UI flow:** 10/10 pass.
  - The sample `.xlsx` and `.csv` load through the real file input; the preview and column mapper
    render, with Title auto-mapped.
  - A hostile spreadsheet loads as inert, escaped text: `<img onerror>` and `<script>` in the cells,
    the Article ID and the file name.
- **Docker** (`node:26-alpine`):
  - The image builds, runs as `node`, and the temp dir is `0700`.
  - `localhost` and `127.0.0.1` get 200; a foreign `Host` gets 421; `ALLOWED_HOSTS=myserver.lan`
    gives 200 for that name.
  - CSP, `nosniff` and `X-Frame-Options` headers are present.
- **CLI:** `--help` works and a `--dry-run` over the sample workbook and mapping completes (3 rows,
  nothing created).
- **Packaging:** `electron-builder --linux dir` succeeds locally. The Windows, macOS and Linux
  builds run in CI through the release workflow (`workflow_dispatch`, no publish) before merge.
- **CI:** the release workflow (`workflow_dispatch`, no publish) built every artifact at 2.2.0 on
  Windows, macOS and Linux: the portable `.exe`, the setup `.exe`, the `.dmg`, the `.AppImage` and
  the three `latest*.yml` files. The Test (Node 22/26) and CodeQL checks pass.
- **Not covered by automation:** live calls to the Figshare API, which need a real account token.
  The only change to the API client (`lib/figshare.js`) is the Article ID check, which runs before
  any request is made.

### Residual risk (accepted)
- **Auto-update trusts the GitHub release metadata.** electron-updater verifies the download against
  the SHA-512 in `latest*.yml`, which comes from the same GitHub release. The cosign-signed
  `SHA256SUMS.txt` is not checked in-app. Someone able to replace release assets (i.e. with write
  access to the repository) could therefore ship an update that installs after *Restart to update*.
  That attacker could equally replace the manual downloads. Mitigations in place:
  - Releases are built only by CI from tags.
  - The update is never installed silently.
  - The signed checksums allow independent verification.

  Removing this risk needs either paid code signing (electron-updater then checks the publisher)
  or in-app Sigstore verification. That is tracked as a follow-up and is out of scope for this
  change.
- **Results CSV opened with a non-comma delimiter.** Cells are neutralised against formulas
  (a leading `=`, `+`, `-`, `@`, tab or CR gets a `'`), which is the standard mitigation for a
  comma-separated file. If the file is opened as semicolon- or tab-delimited, for example by Excel
  in some European locales, a title containing `;=…` could split into a new cell that starts with
  a formula. Quoting such cells was tried and broke semicolon-delimited re-import, so it was
  reverted. Excel users should use the XLSX write-back export, which stores every value as text.

### Implementation
1. Merge #60 to `main` (Test and CodeQL green).
2. Tag `v2.2.0` on the merge commit and push the tag. The release workflow builds, checksums,
   signs and publishes.
3. Close the superseded Dependabot PRs.

### Rollback
- **Desktop:** v2.1.3 stays on the Releases page. Users reinstall it, and electron-updater will
  not downgrade automatically. To withdraw v2.2.0, mark the GitHub release as a pre-release or
  delete it so that update checks fall back to v2.1.3.
- **Source / Docker:** `git revert` the merge commit of #60 (and #59 if needed) and rebuild the
  image. No data migration is involved, and the app stores no server-side state.
- **Partial rollback:** a hosted deployment hit by the Host check can set `ALLOWED_HOSTS=*` as a
  temporary measure, without rolling back. One behind a proxy can set `TRUST_PROXY=1`.

### Post-implementation checks
- [ ] The release workflow for `v2.2.0` succeeded on all three OSes.
- [ ] The release has the Windows portable and installer, the macOS `.dmg`, the Linux AppImage,
      `latest*.yml`, `SHA256SUMS.txt` and `SHA256SUMS.txt.sigstore.json`.
- [ ] `cosign verify-blob --bundle …` (see ASSURANCE.md) verifies `SHA256SUMS.txt`.
- [ ] Dependabot shows 0 open alerts and code scanning shows no new alerts.

---

## Template

```markdown
## CR-YYYY-MM-DD-NN

| Field | Value |
| --- | --- |
| Title | |
| Type | Standard / Normal / Emergency |
| Version | a.b.c → x.y.z |
| Requested / approved by | |
| Pull requests | |
| Status | |

### Reason
### Scope
### Risk and impact
### Test evidence
### Implementation
### Rollback
### Post-implementation checks
```
