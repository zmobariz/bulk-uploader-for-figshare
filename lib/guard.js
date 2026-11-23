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

/** "example.com:4000" -> "4000", "[::1]:4000" -> "4000", "example.com" -> "". */
function portOf(hostHeader) {
  const h = String(hostHeader || '').trim();
  const tail = h.startsWith('[') ? h.slice(h.indexOf(']') + 1) : h;
  const colon = tail.lastIndexOf(':');
  return colon === -1 ? '' : tail.slice(colon + 1);
}

const DEFAULT_PORT = { http: '80', https: '443' };
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const firstValue = (v) => String(v || '').split(',')[0].trim().toLowerCase();

/**
 * The host and scheme the browser actually used. By default these are the Host header and
 * plain http (the server only speaks http). With trustProxy (TRUST_PROXY=1), a reverse
 * proxy's X-Forwarded-Host / X-Forwarded-Proto are used instead, and the SAME effective
 * host is then checked against the allow-list and compared with Origin. Forwarded headers
 * are ignored unless trusted, because a page that has DNS-rebound its own name onto the
 * server can set them on its own requests.
 */
function effectiveHost(req, trustProxy) {
  const fwdHost = trustProxy ? firstValue(req.headers['x-forwarded-host']) : '';
  const fwdProto = trustProxy ? firstValue(req.headers['x-forwarded-proto']) : '';
  return { host: fwdHost || String(req.headers.host || '').trim().toLowerCase(), proto: fwdProto || 'http' };
}

/** Does Origin name the same scheme + host (+ port, when the host header carries one)? */
function originMatches(origin, eff) {
  let o;
  try { o = new URL(origin); } catch (e) { return false; } // includes "null"
  if (o.protocol !== eff.proto + ':') return false;
  const oHost = o.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (oHost !== hostnameOf(eff.host)) return false;
  // A host without a port means the scheme's default port (as browsers serialise it). A proxy on a
  // non-default port must forward it (nginx: $http_host, not $host) — never treat a bare host as "any port".
  const effPort = portOf(eff.host) || DEFAULT_PORT[eff.proto];
  return (o.port || DEFAULT_PORT[eff.proto]) === effPort;
}

function hostAndOrigin(allowed, { trustProxy = false } = {}) {
  return (req, res, next) => {
    const eff = effectiveHost(req, trustProxy);
    if (allowed && !allowed.has(hostnameOf(eff.host))) {
      return res.status(421).json({ ok: false, error: 'Unrecognised Host header. Set ALLOWED_HOSTS to serve this hostname.' });
    }
    if (!SAFE_METHODS.has(req.method)) {
      const origin = req.headers.origin;
      const site = req.headers['sec-fetch-site'];
      const sameOrigin = origin === undefined || originMatches(origin, eff);
      if (!sameOrigin || site === 'cross-site' || site === 'same-site') {
        return res.status(403).json({ ok: false, error: 'Cross-origin request refused.' });
      }
    }
    next();
  };
}

const isArticleId = (v) => /^[1-9][0-9]{0,15}$/.test(String(v).trim());

module.exports = { securityHeaders, allowedHosts, hostnameOf, portOf, effectiveHost, originMatches, hostAndOrigin, isArticleId, CSP };
