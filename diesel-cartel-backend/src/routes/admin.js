// ============================================================
// Admin routes — protected by a single bearer token (see lib/auth.js).
// MVP-grade product CRUD + order lookup so you (or a future
// developer) can manage the catalog without touching SQLite by hand.
// Not exposed to the storefront front-end at all.
// ============================================================
import { db } from '../db.js';
import { sendJson, HttpError } from '../lib/http.js';

function requireFields(body, fields) {
  for (const f of fields) {
    if (body[f] === undefined || body[f] === null || body[f] === '') {
      throw new HttpError(400, `Missing required field: ${f}`);
    }
  }
}

export function adminListOrders(req, res) {
  const orders = db.prepare('SELECT * FROM orders ORDER BY created_at DESC LIMIT 200').all();
  sendJson(res, 200, orders.map((o) => ({
    id: o.id,
    status: o.status,
    customerEmail: o.customer_email,
    total: o.total_cents / 100,
    currency: o.currency,
    createdAt: o.created_at,
  })));
}

// Full product list for the admin UI — unlike the public /api/products
// route, this includes inactive products and the supplier field (not
// meant for customer eyes: it's your sourcing info).
export function adminListProducts(req, res) {
  const rows = db.prepare('SELECT * FROM products ORDER BY name ASC').all();
  sendJson(res, 200, rows.map((r) => ({
    id: r.id,
    sku: r.sku,
    name: r.name,
    price: r.price_cents / 100,
    stockQty: r.stock_qty,
    active: !!r.active,
    supplier: r.supplier || '',
    weightLbs: r.weight_lbs,
    categorySlug: r.category_slug,
  })));
}

export function adminCreateProduct(req, res, params, body) {
  requireFields(body, ['id', 'sku', 'name', 'categorySlug', 'priceCents']);
  db.prepare(`
    INSERT INTO products (id, sku, name, brand, category_slug, platform_slug, price_cents, compare_at_cents,
      badge, icon, rating, reviews, description, features_json, image_url, active, stock_qty)
    VALUES (@id, @sku, @name, @brand, @categorySlug, @platformSlug, @priceCents, @compareAtCents,
      @badge, @icon, @rating, @reviews, @description, @featuresJson, @imageUrl, @active, @stockQty)
  `).run({
    id: body.id,
    sku: body.sku,
    name: body.name,
    brand: body.brand || null,
    categorySlug: body.categorySlug,
    platformSlug: body.platformSlug || null,
    priceCents: body.priceCents,
    compareAtCents: body.compareAtCents ?? null,
    badge: body.badge || null,
    icon: body.icon || null,
    rating: body.rating ?? 0,
    reviews: body.reviews ?? 0,
    description: body.description || null,
    featuresJson: JSON.stringify(body.features || []),
    imageUrl: body.imageUrl || null,
    active: body.active === false ? 0 : 1,
    stockQty: body.stockQty ?? 0,
  });
  sendJson(res, 201, { ok: true, id: body.id });
}

const UPDATABLE_FIELDS = {
  name: 'name', brand: 'brand', categorySlug: 'category_slug', platformSlug: 'platform_slug',
  priceCents: 'price_cents', compareAtCents: 'compare_at_cents', badge: 'badge', icon: 'icon',
  rating: 'rating', reviews: 'reviews', description: 'description', imageUrl: 'image_url',
  active: 'active', stockQty: 'stock_qty', supplier: 'supplier', weightLbs: 'weight_lbs',
};

export function adminUpdateProduct(req, res, params, body) {
  const existing = db.prepare('SELECT id FROM products WHERE id = ?').get(params.id);
  if (!existing) throw new HttpError(404, 'Product not found');

  const sets = [];
  const values = {};
  for (const [key, column] of Object.entries(UPDATABLE_FIELDS)) {
    if (body[key] !== undefined) {
      sets.push(`${column} = @${key}`);
      values[key] = key === 'active' ? (body[key] ? 1 : 0) : body[key];
    }
  }
  if (body.features !== undefined) {
    sets.push('features_json = @featuresJson');
    values.featuresJson = JSON.stringify(body.features);
  }
  if (sets.length === 0) throw new HttpError(400, 'No updatable fields provided');

  sets.push("updated_at = datetime('now')");
  values.id = params.id;
  db.prepare(`UPDATE products SET ${sets.join(', ')} WHERE id = @id`).run(values);
  sendJson(res, 200, { ok: true });
}

export function adminDeleteProduct(req, res, params) {
  // Soft delete — keep order history referencing this product id intact.
  const result = db.prepare("UPDATE products SET active = 0, updated_at = datetime('now') WHERE id = ?").run(params.id);
  if (result.changes === 0) throw new HttpError(404, 'Product not found');
  sendJson(res, 200, { ok: true });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ============================================================
// Purchase order generation. There's no live API/EDI connection to
// any real distributor (Dix Performance, APG Wholesale, Meyers,
// Suntop Hi-Tech) — none of them expose one publicly, and wiring
// one up would need a dealer/EDI agreement negotiated with each
// supplier directly. What this DOES do: the moment you need to
// actually order stock to fulfill a paid order, it builds a clean,
// print-ready sheet grouped by supplier (from the `supplier` field
// you set per product in Admin -> Products) so there's zero manual
// re-typing of what a customer bought. You still send/submit it to
// each supplier yourself (email, fax, portal, phone) until a real
// integration exists.
// ============================================================
export function adminGetPurchaseOrder(req, res, params) {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(params.id);
  if (!order) throw new HttpError(404, 'Order not found');
  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);

  const UNASSIGNED = 'Unassigned — set a supplier on this product in Admin → Products';
  const groups = new Map();
  for (const item of items) {
    if (item.product_id === 'shipping' || item.product_id === 'tax') continue;
    const product = db.prepare('SELECT sku, supplier FROM products WHERE id = ?').get(item.product_id);
    const supplier = (product && product.supplier) ? product.supplier : UNASSIGNED;
    if (!groups.has(supplier)) groups.set(supplier, []);
    groups.get(supplier).push({
      sku: product ? product.sku : '(product no longer in catalog)',
      name: item.name_snapshot,
      qty: item.qty,
      price: item.price_cents_snapshot / 100,
    });
  }

  let groupsHtml = '';
  for (const [supplier, lineItems] of groups) {
    const rows = lineItems.map((li) => `
        <tr>
          <td>${escapeHtml(li.sku)}</td>
          <td>${escapeHtml(li.name)}</td>
          <td style="text-align:center">${li.qty}</td>
          <td style="text-align:right">$${li.price.toFixed(2)}</td>
        </tr>`).join('');
    groupsHtml += `
      <h2>${escapeHtml(supplier)}</h2>
      <table>
        <thead><tr><th>SKU</th><th>Product</th><th>Qty</th><th>Retail unit price</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  }

  const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>Purchase Order — Order #${order.id}</title>
<style>
  body { font-family: -apple-system, Arial, sans-serif; max-width: 800px; margin: 40px auto; color: #222; padding: 0 16px; }
  h1 { font-size: 20px; border-bottom: 2px solid #222; padding-bottom: 10px; }
  h2 { font-size: 15px; margin-top: 28px; background: #eee; padding: 6px 10px; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 13px; }
  th, td { border: 1px solid #ccc; padding: 6px 8px; }
  th { background: #f5f5f5; text-align: left; }
  .meta { font-size: 13px; color: #555; margin-bottom: 20px; }
  .note { font-size: 12px; color: #888; margin-top: 30px; line-height: 1.5; }
  button { margin-top: 20px; padding: 8px 16px; font-size: 14px; cursor: pointer; }
  @media print { button { display: none; } }
</style></head>
<body>
  <h1>Purchase Order — Order #${order.id}</h1>
  <div class="meta">
    Customer order placed: ${order.created_at} UTC<br>
    Order status: ${order.status}<br>
    Generated: ${new Date().toISOString()}
  </div>
  ${groupsHtml || '<p>No purchasable line items on this order.</p>'}
  <p class="note">Auto-generated from Diesel Cartel Canada order #${order.id}. Quantities reflect what the customer purchased —
  verify against current on-hand stock before submitting to a supplier. This is not sent anywhere automatically;
  print/save it and send it to each supplier yourself.</p>
  <button onclick="window.print()">Print / Save as PDF</button>
</body></html>`;

  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}
