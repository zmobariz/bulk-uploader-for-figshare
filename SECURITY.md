# Security policy

## Reporting a vulnerability
Please report security issues **privately**: open a draft advisory at
https://github.com/zmobariz/bulk-uploader-for-figshare/security/advisories/new
(or use the repository's *Report a vulnerability* button). Please don't open public
issues for security reports.

## Threat-model summary
- Runs locally; the web UI binds to loopback (`127.0.0.1`) by default and is not network-reachable.
- Figshare API calls are HTTPS to an allow-list of Figshare hosts (`*.figshare.com`, `*.figsh.com`); other/private/loopback hosts are rejected before any request is made. The only other outbound call is an optional update check to the GitHub Releases API (disable with `NO_UPDATE_CHECK=1`).
- The Figshare personal token is held in memory for the session, sent only to Figshare, and never written to disk or logged.
- No telemetry; an optional update check contacts the GitHub Releases API (disable with `NO_UPDATE_CHECK=1`). Dependencies are scanned (Dependabot + CodeQL); release binaries are built in CI from tagged source and published with SHA-256 checksums signed with Sigstore cosign.
- The UI is served with a strict Content-Security-Policy; the local server refuses unexpected `Host` headers (DNS rebinding) and cross-origin state-changing requests (CSRF); the desktop renderer is sandboxed with no Node.js access and cannot navigate away from the app. See the *Application hardening* section of [ASSURANCE.md](ASSURANCE.md).

## Supported versions
Security fixes are made on the latest release only. Desktop users on the Windows installer or Linux AppImage are notified of new releases in-app; other users should update from the Releases page.

Full notes: [docs/DEPLOYMENT-AND-SECURITY.md](docs/DEPLOYMENT-AND-SECURITY.md).
