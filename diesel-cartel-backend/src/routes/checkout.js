// ============================================================
// Checkout route. This is the one place in the whole backend where
// getting it wrong costs real money, so the rule is absolute:
//
//   NEVER trust a price, quantity-derived subtotal, or total sent
//   by the client. Look up every product by id in our own database
//   and compute everything server-side, every time.
//
// The client only gets to say *which* product ids and quantities it
// wants — not what they cost.
// ============================================================
import { db } from '../db.js';
import { sendJson, HttpError } from '../lib/http.js';
import { createCheckoutSession } from '../lib/stripe.js';

const FREE_SHIP_THRESHOLD_CENTS = 15000;
const FREE_SHIP_MAX_WEIGHT_LBS = 10; // free-shipping perk only applies to lighter carts — see note below
const TAX_RATE = 0.12; // flat demo rate — swap for a real tax service before going live in multiple provinces

// Weight-tiered flat-rate shipping. This is an approximation, not a live
// carrier quote (no Freightcom/Freightera account is connected yet) —
// good enough to avoid under/over-charging by much while keeping checkout
// simple. Revisit these dollar amounts once real shipping invoices come in.
const SHIPPING_TIERS = [
  { maxLbs: 2, cents: 1299 },
  { maxLbs: 10, cents: 1999 },
  { maxLbs: 30, cents: 3499 },
  { maxLbs: 70, cents: 7999 },
  { maxLbs: 150, cents: 14999 },
];

// Per-category fallback weight (lbs) for products that don't have a real
// weight set yet in Admin -> Products. Rough real-world ballparks for
// diesel performance parts — replace with actual weights as they're entered.
const CATEGORY_DEFAULT_WEIGHT_LBS = {
  tuning: 2,
  exhaust: 25,
  turbochargers: 45,
  suspension: 60,
  wheels: 80,
  intake: 8,
  fuel: 5,
  apparel: 1,
};
const FALLBACK_WEIGHT_LBS = 5; // used if a product has no category match either

function effectiveWeightLbs(product) {
  if (product.weight_lbs != null) return product.weight_lbs;
  return CATEGORY_DEFAULT_WEIGHT_LBS[product.category_slug] ?? FALLBACK_WEIGHT_LBS;
}

function shippingCentsForWeight(totalWeightLbs, subtotalCents) {
  if (totalWeightLbs === 0) return 0;
  if (totalWeightLbs > 150) {
    throw new HttpError(
      422,
      'This order is too heavy for automatic shipping calculation (over 150 lbs). ' +
      'Contact us directly for a freight quote before ordering.'
    );
  }
  if (totalWeightLbs <= FREE_SHIP_MAX_WEIGHT_LBS && subtotalCents >= FREE_SHIP_THRESHOLD_CENTS) return 0;
  const tier = SHIPPING_TIERS.find((t) => totalWeightLbs <= t.maxLbs);
  return tier.cents;
}

function computeTotals(lineItems) {
  const subtotalCents = lineItems.reduce((sum, li) => sum + li.priceCents * li.qty, 0);
  const totalWeightLbs = lineItems.reduce((sum, li) => sum + li.weightLbs * li.qty, 0);
  const shippingCents = subtotalCents === 0 ? 0 : shippingCentsForWeight(totalWeightLbs, subtotalCents);
  const taxCents = Math.round(subtotalCents * TAX_RATE);
  const totalCents = subtotalCents + shippingCents + taxCents;
  return { subtotalCents, shippingCents, taxCents, totalCents, totalWeightLbs };
}

export async function createCheckout(req, res, params, body) {
  const items = Array.isArray(body.items) ? body.items : [];
  if (items.length === 0) throw new HttpError(400, 'items is required and must be a non-empty array');

  const origin = body.origin || process.env.STOREFRONT_URL;
  if (!origin) throw new HttpError(400, 'origin (storefront base URL) is required');

  // Look up every requested product from OUR database — this is the
  // server-verified price/name/stock, never the client's copy.
  const lineItems = [];
  for (const item of items) {
    const qty = Math.max(1, Math.min(99, Math.floor(Number(item.qty) || 1)));
    const product = db.prepare('SELECT * FROM products WHERE id = ? AND active = 1').get(item.productId);
    if (!product) throw new HttpError(400, `Unknown or inactive product: ${item.productId}`);
    if (product.stock_qty < qty) {
      throw new HttpError(409, `Not enough stock for ${product.name} (have ${product.stock_qty}, wanted ${qty})`);
    }
    lineItems.push({
      productId: product.id,
      name: product.name,
      priceCents: product.price_cents,
      weightLbs: effectiveWeightLbs(product),
      qty,
    });
  }

  const totals = computeTotals(lineItems);

  const insertOrder = db.prepare(`
    INSERT INTO orders (status, customer_email, subtotal_cents, shipping_cents, tax_cents, total_cents, currency)
    VALUES ('pending', ?, ?, ?, ?, ?, 'cad')
  `);
  const orderResult = insertOrder.run(
    body.customerEmail || null,
    totals.subtotalCents,
    totals.shippingCents,
    totals.taxCents,
    totals.totalCents
  );
  const orderId = orderResult.lastInsertRowid;

  const insertItem = db.prepare(`
    INSERT INTO order_items (order_id, product_id, name_snapshot, price_cents_snapshot, qty)
    VALUES (?, ?, ?, ?, ?)
  `);
  for (const li of lineItems) {
    insertItem.run(orderId, li.productId, li.name, li.priceCents, li.qty);
  }

  // Stripe Checkout Session line items are the per-product prices;
  // shipping + tax are added as their own line items so the Stripe
  // total matches what we just computed and stored.
  const stripeLineItems = lineItems.map((li) => ({ ...li }));
  if (totals.shippingCents > 0) {
    stripeLineItems.push({ productId: 'shipping', name: 'Shipping', priceCents: totals.shippingCents, qty: 1 });
  }
  if (totals.taxCents > 0) {
    stripeLineItems.push({ productId: 'tax', name: 'Tax (HST/GST est.)', priceCents: totals.taxCents, qty: 1 });
  }

  let session;
  try {
    session = await createCheckoutSession({
      lineItems: stripeLineItems,
      successUrl: `${origin.replace(/\/$/, '')}/confirmation.html?session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${origin.replace(/\/$/, '')}/cart.html`,
      customerEmail: body.customerEmail,
      metadata: { order_id: String(orderId) },
    });
  } catch (err) {
    db.prepare('UPDATE orders SET status = ? WHERE id = ?').run('failed', orderId);
    throw new HttpError(502, `Stripe error: ${err.message}`);
  }

  db.prepare('UPDATE orders SET stripe_session_id = ? WHERE id = ?').run(session.id, orderId);

  sendJson(res, 200, { orderId, checkoutUrl: session.url, sessionId: session.id });
}

export function getOrderBySession(req, res, params) {
  const order = db.prepare('SELECT * FROM orders WHERE stripe_session_id = ?').get(params.sessionId);
  if (!order) throw new HttpError(404, 'Order not found');
  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
  sendJson(res, 200, {
    id: order.id,
    status: order.status,
    customerEmail: order.customer_email,
    subtotal: order.subtotal_cents / 100,
    shipping: order.shipping_cents / 100,
    tax: order.tax_cents / 100,
    total: order.total_cents / 100,
    currency: order.currency,
    createdAt: order.created_at,
    items: items.map((i) => ({
      productId: i.product_id,
      name: i.name_snapshot,
      price: i.price_cents_snapshot / 100,
      qty: i.qty,
    })),
  });
}
