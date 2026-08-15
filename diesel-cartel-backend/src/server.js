// ============================================================
// HTTP server + hand-rolled router (no Express — see README for why).
// Routes are matched by method + path pattern (":param" segments
// supported). Every handler gets (req, res, params, body) where
// `body` is the parsed JSON body for non-GET requests (the Stripe
// webhook route is special-cased to get the raw body instead, since
// signature verification needs the exact bytes Stripe sent).
// ============================================================
import http from 'node:http';
import { readJsonBody, readRawBody, sendJson, HttpError, parseQuery } from './lib/http.js';
import { applyCors, handlePreflight } from './lib/cors.js';
import { isAdminRequest } from './lib/auth.js';
import { listCategories, listPlatforms, listProducts, getProduct } from './routes/products.js';
import { createCheckout, getOrderBySession } from './routes/checkout.js';
import { stripeWebhook } from './routes/webhooks.js';
import { adminListOrders, adminCreateProduct, adminUpdateProduct, adminDeleteProduct } from './routes/admin.js';

const PORT = Number(process.env.PORT) || 4000;

function compilePattern(pattern) {
  const paramNames = [];
  const regexStr = pattern
    .split('/')
    .map((seg) => {
      if (seg.startsWith(':')) {
        paramNames.push(seg.slice(1));
        return '([^/]+)';
      }
      return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/');
  return { regex: new RegExp(`^${regexStr}$`), paramNames };
}

function route(method, pattern, handler, opts = {}) {
  return { method, ...compilePattern(pattern), handler, admin: !!opts.admin, raw: !!opts.raw };
}

const routes = [
  route('GET', '/api/health', (req, res) => sendJson(res, 200, { ok: true, service: 'diesel-cartel-backend' })),
  route('GET', '/api/categories', listCategories),
  route('GET', '/api/platforms', listPlatforms),
  route('GET', '/api/products', (req, res, params, body, query) => listProducts(req, res, query)),
  route('GET', '/api/products/:id', (req, res, params) => getProduct(req, res, params)),

  route('POST', '/api/checkout/session', (req, res, params, body) => createCheckout(req, res, params, body)),
  route('GET', '/api/orders/by-session/:sessionId', (req, res, params) => getOrderBySession(req, res, params)),

  // Raw-body route: server.js skips JSON parsing for this one and
  // hands the handler the raw Buffer instead (see the dispatch loop).
  route('POST', '/api/webhooks/stripe', (req, res, params, rawBody) => stripeWebhook(req, res, rawBody), { raw: true }),

  route('GET', '/api/admin/orders', (req, res) => adminListOrders(req, res), { admin: true }),
  route('POST', '/api/admin/products', (req, res, params, body) => adminCreateProduct(req, res, params, body), { admin: true }),
  route('PATCH', '/api/admin/products/:id', (req, res, params, body) => adminUpdateProduct(req, res, params, body), { admin: true }),
  route('DELETE', '/api/admin/products/:id', (req, res, params) => adminDeleteProduct(req, res, params), { admin: true }),
];

const server = http.createServer(async (req, res) => {
  if (handlePreflight(req, res)) return;
  applyCors(req, res);

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  try {
    let matched = null;
    let params = null;
    for (const r of routes) {
      if (r.method !== req.method) continue;
      const m = r.regex.exec(url.pathname);
      if (!m) continue;
      params = Object.fromEntries(r.paramNames.map((name, i) => [name, decodeURIComponent(m[i + 1])]));
      matched = r;
      break;
    }

    if (!matched) {
      sendJson(res, 404, { error: 'Not found' });
      return;
    }

    if (matched.admin && !isAdminRequest(req)) {
      sendJson(res, 401, { error: 'Unauthorized' });
      return;
    }

    if (matched.raw) {
      const rawBody = await readRawBody(req);
      await matched.handler(req, res, params, rawBody);
      return;
    }

    const body = ['POST', 'PATCH', 'PUT'].includes(req.method) ? await readJsonBody(req) : {};
    const query = parseQuery(url);
    await matched.handler(req, res, params, body, query);
  } catch (err) {
    if (err instanceof HttpError) {
      sendJson(res, err.statusCode, { error: err.message, details: err.details });
    } else {
      console.error('Unhandled error:', err);
      sendJson(res, 500, { error: 'Internal server error' });
    }
  }
});

server.listen(PORT, () => {
  console.log(`diesel-cartel-backend listening on http://localhost:${PORT}`);
});
