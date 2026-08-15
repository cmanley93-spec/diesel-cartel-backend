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
  active: 'active', stockQty: 'stock_qty',
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
