# Assurance statement

This describes the security posture of **Figshare Bulk Uploader** to help users and IT/security
teams make an informed decision. It does **not** certify the software as free of vulnerabilities.

## What this does and does not prove
- **Does show:** the project is open source and auditable, runs locally with a small trust boundary,
  minimises data exposure, and is supported by automated scanning and reproducible, hash-verifiable builds.
- **Does not prove:** the absence of vulnerabilities, fitness for any particular regulatory regime,
  or any third-party certification.

## Threat model (summary)
- Primary user: a researcher/data manager running the app on their own machine with their own Figshare token.
- The app runs a local HTTP server bound to loopback (`127.0.0.1`) for its UI; it is not network-reachable by default.
- Assets to protect: the Figshare personal token, and the integrity of what is created on Figshare.

## Data handling
- The token is entered by the user, held in memory for the session, sent only to the Figshare API over
  HTTPS, and never written to disk or logged.
- Mappings/preferences are stored locally (no token). Uploaded file bytes are streamed to Figshare;
  temporary copies go to the OS temp dir and are deleted after each row.

## Network behaviour
- The only outbound calls are HTTPS to an allow-list of Figshare hosts (`figshare.com`, `figsh.com`).
  Other, private, loopback and link-local hosts are rejected before any request is made.
- No telemetry, analytics, crash reporting, update checks or third-party/CDN calls at runtime
  (the SheetJS library is bundled).

## Build & release integrity
- Release binaries (Windows portable + per-user installer, macOS `.dmg`, Linux AppImage) are built by
  GitHub Actions from tagged source (`.github/workflows/release.yml`).
- Each release includes `SHA256SUMS.txt`. Verify before distributing
  (`Get-FileHash <file> -Algorithm SHA256`, or `shasum -a 256 <file>`).
- Binaries are **not code-signed** (no paid certificate); first launch triggers SmartScreen/Gatekeeper.
  On application-allow-listing platforms (WDAC/AppLocker), allow-list by the published SHA-256.

## Dependency & code scanning
- Dependabot (alerts + weekly grouped update PRs) and CodeQL code scanning run on the repository;
  GitHub secret scanning is enabled for the public repo. `npm audit` is part of the maintenance loop.

## Vulnerability disclosure
- Report privately via GitHub Security Advisories:
  https://github.com/zmobariz/figshare-uploader-web/security/advisories/new — see `SECURITY.md`.

## Known limitations
- Unsigned binaries (SmartScreen/Gatekeeper prompts; no publisher-based allow-list rules).
- No formal third-party security audit or certification.
- Duplicate detection matches on Title (or an Article ID column), not a cryptographic key.
- Static analysis (CodeQL) flags the API-proxy fetch as a potential SSRF. This is mitigated by the
  Figshare host allow-list plus loopback binding, and is recorded as a reviewed, dismissed finding
  (the analyzer cannot model the allow-list because uploads use dynamic `*.figshare.com` subdomains).

## Privacy
- The tool collects no personal data itself. All data flows are between the user's machine and Figshare.
