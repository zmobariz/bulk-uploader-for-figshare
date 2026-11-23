/**
 * lib/guard.js — HTTP hardening for the local web server.
 *
 *  - securityHeaders: strict CSP (scripts from this origin only, no inline
 *    script, no framing) plus the usual nosniff / referrer / frame headers.
 *  - hostAndOrigin: rejects requests whose Host header is not an expected name
 *    (defeats DNS-rebinding: a web page that re-points its own hostname at
 *    127.0.0.1 still sends its own name as Host), and rejects state-changing
 *    requests sent from another origin (cross-site form posts / fetches).
 *  - isArticleId: Figshare article IDs are positive integers; anything else is
 *    refused before it is used in an API path or echoed back to the UI.
 */

const LOOPBACK_NAMES = ['127.0.0.1', 'localhost', '::1'];

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "style-src-attr 'unsafe-inline'", // inline style="" attributes only; no <style>/<script> injection
  "img-src 'self' data:",
  "connect-src 'self'",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

function securityHeaders(_req, res, next) {
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), usb=(), hid=(), serial=()');
  next();
}

/**
 * Allowed Host names. Default: loopback names only. ALLOWED_HOSTS adds names
 * (comma-separated, e.g. "uploader.example.ac.uk"); "*" turns the check off
 * (only for deployments behind a proxy that already pins the Host header).
 */
function allowedHosts(env) {
  const extra = String(env || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (extra.includes('*')) return null;
  return new Set([...LOOPBACK_NAMES, ...extra]);
}

/** "example.com:4000" -> "example.com", "[::1]:4000" -> "::1". */
function hostnameOf(hostHeader) {
  const h = String(hostHeader || '').trim().toLowerCase();
  if (!h) return '';
  if (h.startsWith('[')) { const end = h.indexOf(']'); return end > 0 ? h.slice(1, end) : ''; }
  const colon = h.indexOf(':');
  return colon === -1 ? h : h.slice(0, colon);
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function hostAndOrigin(allowed) {
  return (req, res, next) => {
    const host = req.headers.host || '';
    if (allowed && !allowed.has(hostnameOf(host))) {
      return res.status(421).json({ ok: false, error: 'Unrecognised Host header. Set ALLOWED_HOSTS to serve this hostname.' });
    }
    if (!SAFE_METHODS.has(req.method)) {
      const origin = req.headers.origin;
      const site = req.headers['sec-fetch-site'];
      let sameOrigin = true;
      if (origin !== undefined) {
        // Behind a reverse proxy that rewrites Host, the browser-visible host arrives as
        // X-Forwarded-Host. Matching it is safe: a cross-site page (CSRF) or a rebinding
        // page cannot set that header on a browser request.
        const fwd = String(req.headers['x-forwarded-host'] || '').split(',')[0].trim().toLowerCase();
        // The server itself only speaks HTTP; a TLS-terminating proxy says so in X-Forwarded-Proto.
        const proto = String(req.headers['x-forwarded-proto'] || 'http').split(',')[0].trim().toLowerCase();
        try {
          const o = new URL(origin); // throws on "null"
          sameOrigin = o.protocol === proto + ':' && (o.host === host.toLowerCase() || (!!fwd && o.host === fwd));
        } catch (e) { sameOrigin = false; }
      }
      if (!sameOrigin || site === 'cross-site' || site === 'same-site') {
        return res.status(403).json({ ok: false, error: 'Cross-origin request refused.' });
      }
    }
    next();
  };
}

const isArticleId = (v) => /^[1-9][0-9]{0,15}$/.test(String(v).trim());

module.exports = { securityHeaders, allowedHosts, hostnameOf, hostAndOrigin, isArticleId, CSP };
