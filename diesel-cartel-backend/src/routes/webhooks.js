// ============================================================
// Stripe webhook handler. Requires the *raw* request body (server.js
// reads this route's body without JSON-parsing it first) because
// signature verification is computed over the exact bytes Stripe
// sent, not a re-serialized version of them.
// ============================================================
import { db } from '../db.js';
import { sendJson, HttpError } from '../lib/http.js';
import { verifyWebhookSignature } from '../lib/stripe.js';

export async function stripeWebhook(req, res, rawBody) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new HttpError(500, 'STRIPE_WEBHOOK_SECRET is not configured');

  let event;
  try {
    event = verifyWebhookSignature(rawBody.toString('utf8'), req.headers['stripe-signature'], secret);
  } catch (err) {
    throw new HttpError(400, `Webhook signature verification failed: ${err.message}`);
  }

  switch (event.type) {
    case 'checkout.session.completed':
      handleCheckoutCompleted(event.data.object);
      break;
    case 'checkout.session.expired':
      db.prepare('UPDATE orders SET status = ?, updated_at = datetime("now") WHERE stripe_session_id = ?').run(
        'failed',
        event.data.object.id
      );
      break;
    default:
      // Ignore event types we don't act on yet — still return 200 so
      // Stripe doesn't retry them forever.
      break;
  }

  sendJson(res, 200, { received: true });
}

function handleCheckoutCompleted(session) {
  const order = db.prepare('SELECT * FROM orders WHERE stripe_session_id = ?').get(session.id);
  if (!order) return; // unknown session — nothing to reconcile
  if (order.status === 'paid') return; // idempotent: Stripe may send this event more than once

  db.prepare(`
    UPDATE orders
    SET status = 'paid',
        stripe_payment_intent = ?,
        customer_name = ?,
        shipping_address_json = ?,
        updated_at = datetime('now')
    WHERE id = ?
  `).run(
    session.payment_intent || null,
    session.customer_details?.name || null,
    session.shipping_details ? JSON.stringify(session.shipping_details) : null,
    order.id
  );

  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
  const decrementStock = db.prepare('UPDATE products SET stock_qty = MAX(0, stock_qty - ?) WHERE id = ?');
  for (const item of items) {
    if (item.product_id === 'shipping' || item.product_id === 'tax') continue;
    decrementStock.run(item.qty, item.product_id);
  }
}
