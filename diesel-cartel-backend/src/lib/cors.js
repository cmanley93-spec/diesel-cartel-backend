// ============================================================
// CORS helper. The storefront (diesel-site) is a static front-end
// that will call this API cross-origin (different host/port, and
// eventually a different domain than the API subdomain). Keep the
// allow-list in one env var so prod can lock it down to the real
// domain while local dev stays easy.
// ============================================================

function allowedOrigins() {
  const raw = process.env.CORS_ORIGINS || '*';
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

export function applyCors(req, res) {
  const origins = allowedOrigins();
  const reqOrigin = req.headers.origin;

  if (origins.includes('*')) {
    res.setHeader('Access-Control-Allow-Origin', '*');
  } else if (reqOrigin && origins.includes(reqOrigin)) {
    res.setHeader('Access-Control-Allow-Origin', reqOrigin);
    res.setHeader('Vary', 'Origin');
  }

  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '86400');
}

/** Returns true if this request was an OPTIONS preflight and has been fully handled. */
export function handlePreflight(req, res) {
  if (req.method === 'OPTIONS') {
    applyCors(req, res);
    res.writeHead(204);
    res.end();
    return true;
  }
  return false;
}
