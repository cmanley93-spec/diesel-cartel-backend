// ============================================================
// Public read routes: categories, platforms, products (list + detail).
// ============================================================
import { db } from '../db.js';
import { sendJson, HttpError } from '../lib/http.js';

function rowToProduct(row) {
  return {
    id: row.id,
    sku: row.sku,
    name: row.name,
    brand: row.brand,
    category: row.category_slug,
    platform: row.platform_slug,
    price: row.price_cents / 100,
    compareAt: row.compare_at_cents != null ? row.compare_at_cents / 100 : undefined,
    badge: row.badge || undefined,
    icon: row.icon || undefined,
    rating: row.rating,
    reviews: row.reviews,
    desc: row.description || '',
    features: JSON.parse(row.features_json || '[]'),
    image: row.image_url || undefined,
    stockQty: row.stock_qty,
    active: !!row.active,
  };
}

const SORTS = {
  featured: "CASE WHEN badge = 'best' THEN 0 WHEN badge = 'new' THEN 1 ELSE 2 END, rating DESC",
  'price-asc': 'price_cents ASC',
  'price-desc': 'price_cents DESC',
  rating: 'rating DESC, reviews DESC',
  name: 'name ASC',
};

export function listCategories(req, res) {
  const rows = db.prepare('SELECT * FROM categories').all();
  sendJson(res, 200, rows.map((r) => ({ slug: r.slug, name: r.name, blurb: r.blurb, icon: r.icon })));
}

export function listPlatforms(req, res) {
  const rows = db.prepare('SELECT * FROM platforms').all();
  sendJson(res, 200, rows.map((r) => ({ slug: r.slug, name: r.name, sub: r.sub, years: r.years })));
}

export function listProducts(req, res, query) {
  const clauses = ['active = 1'];
  const params = {};

  if (query.category) {
    clauses.push('category_slug = :category');
    params.category = query.category;
  }
  if (query.platform) {
    clauses.push('(platform_slug = :platform OR platform_slug = "universal")');
    params.platform = query.platform;
  }
  if (query.q) {
    clauses.push('(name LIKE :q OR brand LIKE :q OR sku LIKE :q)');
    params.q = `%${query.q}%`;
  }
  if (query.minPrice) {
    clauses.push('price_cents >= :minPrice');
    params.minPrice = Math.round(Number(query.minPrice) * 100);
  }
  if (query.maxPrice) {
    clauses.push('price_cents <= :maxPrice');
    params.maxPrice = Math.round(Number(query.maxPrice) * 100);
  }

  const sortKey = SORTS[query.sort] ? query.sort : 'featured';
  const orderBy = SORTS[sortKey];

  const sql = `SELECT * FROM products WHERE ${clauses.join(' AND ')} ORDER BY ${orderBy}`;
  const rows = db.prepare(sql).all(params);
  sendJson(res, 200, { count: rows.length, products: rows.map(rowToProduct) });
}

export function getProduct(req, res, params) {
  const row = db.prepare('SELECT * FROM products WHERE id = ? AND active = 1').get(params.id);
  if (!row) throw new HttpError(404, 'Product not found');
  sendJson(res, 200, rowToProduct(row));
}
