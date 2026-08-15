// ============================================================
// Minimal Stripe REST client — no `stripe` npm package required.
// Stripe's API is plain HTTPS + Bearer auth, so this uses the
// platform `fetch` (Node 22 built-in) directly. Two things this
// file does that are easy to get wrong if hand-rolled elsewhere:
//   1. Encodes nested params the way Stripe's API expects
//      (PHP-style brackets: line_items[0][price_data][currency]).
//   2. Verifies webhook signatures per Stripe's documented scheme
//      (HMAC-SHA256 over "{timestamp}.{rawBody}", constant-time
//      compare, with a timestamp tolerance to block replay).
// ============================================================
import crypto from 'node:crypto';

const STRIPE_API = 'https://api.stripe.com/v1';

function requireSecretKey() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error(
      'STRIPE_SECRET_KEY is not set. Add it to .env (see .env.example) — get a test key from https://dashboard.stripe.com/test/apikeys'
    );
  }
  return key;
}

/** Flatten a nested object/array into Stripe's bracket-notation form fields. */
function flattenParams(obj, prefix = '', out = {}) {
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined || value === null) continue;
    const field = prefix ? `${prefix}[${key}]` : key;
    if (Array.isArray(value)) {
      value.forEach((item, i) => {
        if (item !== null && typeof item === 'object') {
          flattenParams(item, `${field}[${i}]`, out);
        } else {
          out[`${field}[${i}]`] = item;
        }
      });
    } else if (typeof value === 'object') {
      flattenParams(value, field, out);
    } else {
      out[field] = value;
    }
  }
  return out;
}

function toFormBody(params) {
  const flat = flattenParams(params);
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(flat)) usp.append(k, String(v));
  return usp.toString();
}

async function stripeRequest(method, endpoint, params) {
  const key = requireSecretKey();
  const res = await fetch(`${STRIPE_API}${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      // Pin an API version so Stripe dashboard/account upgrades don't
      // silently change response shape under you.
      'Stripe-Version': '2024-06-20',
    },
    body: params ? toFormBody(params) : undefined,
  });
  const body = await res.json();
  if (!res.ok) {
    const err = new Error(body?.error?.message || `Stripe API error (${res.status})`);
    err.stripeError = body?.error;
    err.status = res.status;
    throw err;
  }
  return body;
}

/**
 * Create a Checkout Session. `lineItems` must already have
 * server-verified prices (see routes/checkout.js) — never trust
 * a price the client sends you.
 */
export async function createCheckoutSession({ lineItems, successUrl, cancelUrl, customerEmail, metadata }) {
  return stripeRequest('POST', '/checkout/sessions', {
    mode: 'payment',
    success_url: successUrl,
    cancel_url: cancelUrl,
    customer_email: customerEmail || undefined,
    shipping_address_collection: { allowed_countries: ['CA', 'US'] },
    line_items: lineItems.map((li) => ({
      quantity: li.qty,
      price_data: {
        currency: 'cad',
        unit_amount: li.priceCents,
        product_data: {
          name: li.name,
          metadata: { product_id: li.productId },
        },
      },
    })),
    metadata,
  });
}

export async function retrieveCheckoutSession(sessionId) {
  return stripeRequest('GET', `/checkout/sessions/${encodeURIComponent(sessionId)}`);
}

/**
 * Verify a Stripe webhook signature.
 * @param {string} rawBody - the *raw* request body (not parsed JSON)
 * @param {string} sigHeader - the `Stripe-Signature` header value
 * @param {string} secret - your webhook signing secret (whsec_...)
 * @param {number} toleranceSeconds - reject events older than this
 */
export function verifyWebhookSignature(rawBody, sigHeader, secret, toleranceSeconds = 300) {
  if (!sigHeader) throw new Error('Missing Stripe-Signature header');
  const parts = Object.fromEntries(
    sigHeader.split(',').map((kv) => {
      const [k, v] = kv.split('=');
      return [k, v];
    })
  );
  const timestamp = parts.t;
  const signature = parts.v1;
  if (!timestamp || !signature) throw new Error('Malformed Stripe-Signature header');

  const signedPayload = `${timestamp}.${rawBody}`;
  const expected = crypto.createHmac('sha256', secret).update(signedPayload, 'utf8').digest('hex');

  const expectedBuf = Buffer.from(expected, 'hex');
  const actualBuf = Buffer.from(signature, 'hex');
  const signatureValid =
    expectedBuf.length === actualBuf.length && crypto.timingSafeEqual(expectedBuf, actualBuf);

  if (!signatureValid) throw new Error('Webhook signature mismatch');

  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (age > toleranceSeconds) throw new Error('Webhook timestamp outside tolerance (possible replay)');

  return JSON.parse(rawBody);
}
