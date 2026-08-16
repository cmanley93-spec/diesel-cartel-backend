// ============================================================
// Database layer — Node's built-in SQLite (node:sqlite).
// No external dependency: works with a plain `node src/server.js`.
// Swap-out note: if/when you outgrow SQLite, the SQL here is plain
// enough to port to Postgres with minor syntax tweaks (see README).
// ============================================================
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, '..', 'data', 'store.db');

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS categories (
  slug TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  blurb TEXT,
  icon TEXT
);

CREATE TABLE IF NOT EXISTS platforms (
  slug TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  sub TEXT,
  years TEXT
);

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  sku TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  brand TEXT,
  category_slug TEXT REFERENCES categories(slug),
  platform_slug TEXT,
  price_cents INTEGER NOT NULL,
  compare_at_cents INTEGER,
  badge TEXT,
  icon TEXT,
  rating REAL DEFAULT 0,
  reviews INTEGER DEFAULT 0,
  description TEXT,
  features_json TEXT DEFAULT '[]',
  image_url TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  stock_qty INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_slug);
CREATE INDEX IF NOT EXISTS idx_products_platform ON products(platform_slug);
CREATE INDEX IF NOT EXISTS idx_products_active ON products(active);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  stripe_session_id TEXT UNIQUE,
  stripe_payment_intent TEXT,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | paid | failed | refunded
  customer_email TEXT,
  customer_name TEXT,
  shipping_address_json TEXT,
  subtotal_cents INTEGER NOT NULL DEFAULT 0,
  shipping_cents INTEGER NOT NULL DEFAULT 0,
  tax_cents INTEGER NOT NULL DEFAULT 0,
  total_cents INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'cad',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id),
  product_id TEXT NOT NULL,
  name_snapshot TEXT NOT NULL,
  price_cents_snapshot INTEGER NOT NULL,
  qty INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS admin_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

export function migrate() {
  db.exec(SCHEMA);
  // Added after initial launch: which real-world supplier/distributor a
  // product should be purchased from (Dix Performance, APG Wholesale,
  // Meyers, Suntop Hi-Tech, FASS, etc). Nullable — unset until you assign one.
  // SQLite has no "ADD COLUMN IF NOT EXISTS", so this is wrapped to be
  // safe to run on every boot.
  try {
    db.exec('ALTER TABLE products ADD COLUMN supplier TEXT');
  } catch (err) {
    if (!/duplicate column/i.test(err.message)) throw err;
  }
  // Real per-product weight (lbs), used for weight-tiered shipping
  // calculation at checkout. Nullable — falls back to a per-category
  // estimate (see checkout.js) until you enter a real weight.
  try {
    db.exec('ALTER TABLE products ADD COLUMN weight_lbs REAL');
  } catch (err) {
    if (!/duplicate column/i.test(err.message)) throw err;
  }
}

// ============================================================
// FASS Fuel Systems — Titanium Signature Series lift pumps.
// Cody is an authorized FASS dealer; these prices are FASS's own
// MAP (Minimum Advertised Price) — the same floor price every
// authorized dealer must advertise at, cross-checked against a
// live authorized dealer's current listings. This is the FLAGSHIP
// line only (batch 1 of 2 — the higher-output "Plus" and "No-Drop
// Plus" lines are a bigger batch, ~40 more SKUs, held back
// pending a spot-check of this batch against the source pricing).
//
// Uses INSERT OR IGNORE keyed on id, so it only ever ADDS missing
// rows — unlike the placeholder catalog seed, this will never
// overwrite a price/stock/active edit you make in Admin -> Products
// on a later deploy.
// ============================================================
const FASS_STANDARD_PRODUCTS = [
  { id: 'fass-tsf16100g', sku: 'TSF16100G', name: 'FASS Titanium Signature Series 100GPH Lift Pump', platformSlug: 'powerstroke', priceCents: 103533, description: 'FASS Titanium Signature Series lift pump kit, 100 GPH. Fits 2008-2010 Ford F-250/F-350/F-450 6.4L Power Stroke. Integrated 2-micron fuel filter and water separator in one housing, "Whisper Technology" for quieter operation, Mass Flow Return continuous fuel polishing, bolt-on steel bracket mount (no drilling), Limited Lifetime Warranty on the pump body, filter rated for approximately 30,000 miles. MAP pricing.' },
  { id: 'fass-tsf16250g', sku: 'TSF16250G', name: 'FASS Titanium Signature Series 250GPH Lift Pump', platformSlug: 'powerstroke', priceCents: 117832, description: 'FASS Titanium Signature Series lift pump kit, 250 GPH. Fits 2008-2010 Ford F-250/F-350/F-450 6.4L Power Stroke. Integrated 2-micron fuel filter and water separator in one housing, "Whisper Technology" for quieter operation, Mass Flow Return continuous fuel polishing, bolt-on steel bracket mount (no drilling), Limited Lifetime Warranty on the pump body, filter rated for approximately 30,000 miles. MAP pricing.' },
  { id: 'fass-tsf16290g', sku: 'TSF16290G', name: 'FASS Titanium Signature Series 290GPH Lift Pump', platformSlug: 'powerstroke', priceCents: 124982, description: 'FASS Titanium Signature Series lift pump kit, 290 GPH. Fits 2008-2010 Ford F-250/F-350/F-450 6.4L Power Stroke. Integrated 2-micron fuel filter and water separator in one housing, "Whisper Technology" for quieter operation, Mass Flow Return continuous fuel polishing, bolt-on steel bracket mount (no drilling), Limited Lifetime Warranty on the pump body, filter rated for approximately 30,000 miles. MAP pricing.' },
  { id: 'fass-tsf17290f240g', sku: 'TSF17290F240G', name: 'FASS Titanium Signature Series 240GPH Lift Pump', platformSlug: 'powerstroke', priceCents: 124982, description: 'FASS Titanium Signature Series lift pump kit, 240 GPH. Fits 2011-2016 Ford F-250/F-350/F-450 6.7L Power Stroke. Integrated 2-micron fuel filter and water separator in one housing, "Whisper Technology" for quieter operation, Mass Flow Return continuous fuel polishing, bolt-on steel bracket mount (no drilling), Limited Lifetime Warranty on the pump body, filter rated for approximately 30,000 miles. MAP pricing.' },
  { id: 'fass-tsf18250f220g', sku: 'TSF18250F220G', name: 'FASS Titanium Signature Series 220GPH Lift Pump', platformSlug: 'powerstroke', priceCents: 132132, description: 'FASS Titanium Signature Series lift pump kit, 220 GPH. Fits 2017-2022 Ford F-250/F-350/F-450 6.7L Power Stroke. Integrated 2-micron fuel filter and water separator in one housing, "Whisper Technology" for quieter operation, Mass Flow Return continuous fuel polishing, bolt-on steel bracket mount (no drilling), Limited Lifetime Warranty on the pump body, filter rated for approximately 30,000 miles. MAP pricing.' },
  { id: 'fass-tsc08165g', sku: 'TSC08165G', name: 'FASS Titanium Signature Series 165GPH Lift Pump', platformSlug: 'duramax', priceCents: 110682, description: 'FASS Titanium Signature Series lift pump kit, 165 GPH. Fits 1992-2000 GM/Chevrolet 6.5L Turbo Diesel. Integrated 2-micron fuel filter and water separator in one housing, "Whisper Technology" for quieter operation, Mass Flow Return continuous fuel polishing, bolt-on steel bracket mount (no drilling), Limited Lifetime Warranty on the pump body, filter rated for approximately 30,000 miles. MAP pricing.' },
  { id: 'fass-tsc10100g', sku: 'TSC10100G', name: 'FASS Titanium Signature Series 100GPH Lift Pump', platformSlug: 'duramax', priceCents: 102102, description: 'FASS Titanium Signature Series lift pump kit, 100 GPH. Fits 2001-2010 GM/Chevrolet 6.6L Duramax (LB7/LLY/LBZ/LMM). Integrated 2-micron fuel filter and water separator in one housing, "Whisper Technology" for quieter operation, Mass Flow Return continuous fuel polishing, bolt-on steel bracket mount (no drilling), Limited Lifetime Warranty on the pump body, filter rated for approximately 30,000 miles. MAP pricing.' },
  { id: 'fass-tsc10165g', sku: 'TSC10165G', name: 'FASS Titanium Signature Series 165GPH Lift Pump', platformSlug: 'duramax', priceCents: 107821, description: 'FASS Titanium Signature Series lift pump kit, 165 GPH. Fits 2001-2010 GM/Chevrolet 6.6L Duramax (LB7/LLY/LBZ/LMM). Integrated 2-micron fuel filter and water separator in one housing, "Whisper Technology" for quieter operation, Mass Flow Return continuous fuel polishing, bolt-on steel bracket mount (no drilling), Limited Lifetime Warranty on the pump body, filter rated for approximately 30,000 miles. MAP pricing.' },
  { id: 'fass-tsc14140f110g', sku: 'TSC14140F110G', name: 'FASS Titanium Signature Series 110GPH Lift Pump', platformSlug: 'duramax', priceCents: 124982, description: 'FASS Titanium Signature Series lift pump kit, 110 GPH. Fits 2016-2020 GM Colorado/Canyon 2.8L Duramax. Integrated 2-micron fuel filter and water separator in one housing, "Whisper Technology" for quieter operation, Mass Flow Return continuous fuel polishing, bolt-on steel bracket mount (no drilling), Limited Lifetime Warranty on the pump body, filter rated for approximately 30,000 miles. MAP pricing.' },
  { id: 'fass-tsc13180f140g', sku: 'TSC13180F140G', name: 'FASS Titanium Signature Series 140GPH Lift Pump', platformSlug: 'duramax', priceCents: 117832, description: 'FASS Titanium Signature Series lift pump kit, 140 GPH. Fits 2017-2019 GM/Chevrolet 6.6L Duramax L5P. Integrated 2-micron fuel filter and water separator in one housing, "Whisper Technology" for quieter operation, Mass Flow Return continuous fuel polishing, bolt-on steel bracket mount (no drilling), Limited Lifetime Warranty on the pump body, filter rated for approximately 30,000 miles. MAP pricing.' },
  { id: 'fass-tsc13250f220g', sku: 'TSC13250F220G', name: 'FASS Titanium Signature Series 220GPH Lift Pump', platformSlug: 'duramax', priceCents: 124982, description: 'FASS Titanium Signature Series lift pump kit, 220 GPH. Fits 2017-2019 GM/Chevrolet 6.6L Duramax L5P. Integrated 2-micron fuel filter and water separator in one housing, "Whisper Technology" for quieter operation, Mass Flow Return continuous fuel polishing, bolt-on steel bracket mount (no drilling), Limited Lifetime Warranty on the pump body, filter rated for approximately 30,000 miles. MAP pricing.' },
  { id: 'fass-tsd02165g', sku: 'TSD02165G', name: 'FASS Titanium Signature Series 165GPH Lift Pump', platformSlug: 'cummins', priceCents: 106392, description: 'FASS Titanium Signature Series lift pump kit, 165 GPH. Fits 1989-1993 Dodge Ram 5.9L Cummins 12V. Integrated 2-micron fuel filter and water separator in one housing, "Whisper Technology" for quieter operation, Mass Flow Return continuous fuel polishing, bolt-on steel bracket mount (no drilling), Limited Lifetime Warranty on the pump body, filter rated for approximately 30,000 miles. MAP pricing.' },
  { id: 'fass-tsd10290f260g', sku: 'TSD10290F260G', name: 'FASS Titanium Signature Series 260GPH Lift Pump', platformSlug: 'cummins', priceCents: 124982, description: 'FASS Titanium Signature Series lift pump kit, 260 GPH. Fits 1994-1998 Dodge Ram 5.9L Cummins 12V. Integrated 2-micron fuel filter and water separator in one housing, "Whisper Technology" for quieter operation, Mass Flow Return continuous fuel polishing, bolt-on steel bracket mount (no drilling), Limited Lifetime Warranty on the pump body, filter rated for approximately 30,000 miles. MAP pricing.' },
  { id: 'fass-tsd08100g', sku: 'TSD08100G', name: 'FASS Titanium Signature Series 100GPH Lift Pump', platformSlug: 'cummins', priceCents: 99243, description: 'FASS Titanium Signature Series lift pump kit, 100 GPH. Fits 1998.5-2004 Dodge Ram 5.9L Cummins 24V. Integrated 2-micron fuel filter and water separator in one housing, "Whisper Technology" for quieter operation, Mass Flow Return continuous fuel polishing, bolt-on steel bracket mount (no drilling), Limited Lifetime Warranty on the pump body, filter rated for approximately 30,000 miles. MAP pricing.' },
  { id: 'fass-tsd08165g', sku: 'TSD08165G', name: 'FASS Titanium Signature Series 165GPH Lift Pump', platformSlug: 'cummins', priceCents: 106392, description: 'FASS Titanium Signature Series lift pump kit, 165 GPH. Fits 1998.5-2004 Dodge Ram 5.9L Cummins 24V. Integrated 2-micron fuel filter and water separator in one housing, "Whisper Technology" for quieter operation, Mass Flow Return continuous fuel polishing, bolt-on steel bracket mount (no drilling), Limited Lifetime Warranty on the pump body, filter rated for approximately 30,000 miles. MAP pricing.' },
  { id: 'fass-tsd08250g', sku: 'TSD08250G', name: 'FASS Titanium Signature Series 250GPH Lift Pump', platformSlug: 'cummins', priceCents: 117832, description: 'FASS Titanium Signature Series lift pump kit, 250 GPH. Fits 1998.5-2004.5 Dodge Ram 5.9L Cummins 24V. Integrated 2-micron fuel filter and water separator in one housing, "Whisper Technology" for quieter operation, Mass Flow Return continuous fuel polishing, bolt-on steel bracket mount (no drilling), Limited Lifetime Warranty on the pump body, filter rated for approximately 30,000 miles. MAP pricing.' },
  { id: 'fass-tsd07100g', sku: 'TSD07100G', name: 'FASS Titanium Signature Series 100GPH Lift Pump', platformSlug: 'cummins', priceCents: 103533, description: 'FASS Titanium Signature Series lift pump kit, 100 GPH. Fits 2005-2024 Dodge/Ram 5.9L/6.7L Cummins. Integrated 2-micron fuel filter and water separator in one housing, "Whisper Technology" for quieter operation, Mass Flow Return continuous fuel polishing, bolt-on steel bracket mount (no drilling), Limited Lifetime Warranty on the pump body, filter rated for approximately 30,000 miles. MAP pricing.' },
  { id: 'fass-tsd07165g', sku: 'TSD07165G', name: 'FASS Titanium Signature Series 165GPH Lift Pump', platformSlug: 'cummins', priceCents: 107821, description: 'FASS Titanium Signature Series lift pump kit, 165 GPH. Fits 2005-2024 Dodge/Ram 5.9L/6.7L Cummins. Integrated 2-micron fuel filter and water separator in one housing, "Whisper Technology" for quieter operation, Mass Flow Return continuous fuel polishing, bolt-on steel bracket mount (no drilling), Limited Lifetime Warranty on the pump body, filter rated for approximately 30,000 miles. MAP pricing.' },
  { id: 'fass-tsd07290g', sku: 'TSD07290G', name: 'FASS Titanium Signature Series 290GPH Lift Pump', platformSlug: 'cummins', priceCents: 124982, description: 'FASS Titanium Signature Series lift pump kit, 290 GPH. Fits 2005-2024 Dodge/Ram 5.9L/6.7L Cummins. Integrated 2-micron fuel filter and water separator in one housing, "Whisper Technology" for quieter operation, Mass Flow Return continuous fuel polishing, bolt-on steel bracket mount (no drilling), Limited Lifetime Warranty on the pump body, filter rated for approximately 30,000 miles. MAP pricing.' },
  { id: 'fass-tsd11140f110g', sku: 'TSD11140F110G', name: 'FASS Titanium Signature Series 110GPH Lift Pump', platformSlug: 'cummins', priceCents: 124982, description: 'FASS Titanium Signature Series lift pump kit, 110 GPH. Fits 2014-2018 Ram 1500 EcoDiesel. Integrated 2-micron fuel filter and water separator in one housing, "Whisper Technology" for quieter operation, Mass Flow Return continuous fuel polishing, bolt-on steel bracket mount (no drilling), Limited Lifetime Warranty on the pump body, filter rated for approximately 30,000 miles. MAP pricing.' },
];

export function seedFassProducts() {
  const insert = db.prepare(`
    INSERT OR IGNORE INTO products
      (id, sku, name, brand, category_slug, platform_slug, price_cents, description, weight_lbs, supplier, active, stock_qty)
    VALUES
      (@id, @sku, @name, 'FASS', 'fuel', @platformSlug, @priceCents, @description, 26, 'FASS Fuel Systems (authorized dealer, MAP pricing)', 1, 3)
  `);
  for (const p of FASS_STANDARD_PRODUCTS) insert.run(p);
}

migrate();
seedFassProducts();

if (process.argv.includes('--migrate')) {
  console.log('Migration applied to', DB_PATH);
}
