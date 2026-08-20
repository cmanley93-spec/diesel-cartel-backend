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
  { id: 'fass-tsf16100g', sku: 'TSF16100G', name: 'FASS Titanium Signature Series 100GPH Lift Pump — 2008-2010 Ford F-250/F-350/F-450 6.4L Power Stroke', platformSlug: 'powerstroke', priceCents: 103533, description: 'FASS Titanium Signature Series lift pump kit, 100 GPH. Fits 2008-2010 Ford F-250/F-350/F-450 6.4L Power Stroke. Integrated 2-micron fuel filter and water separator in one housing, "Whisper Technology" for quieter operation, Mass Flow Return continuous fuel polishing, bolt-on steel bracket mount (no drilling), Limited Lifetime Warranty on the pump body, filter rated for approximately 30,000 miles. MAP pricing.' },
  { id: 'fass-tsf16250g', sku: 'TSF16250G', name: 'FASS Titanium Signature Series 250GPH Lift Pump — 2008-2010 Ford F-250/F-350/F-450 6.4L Power Stroke', platformSlug: 'powerstroke', priceCents: 117832, description: 'FASS Titanium Signature Series lift pump kit, 250 GPH. Fits 2008-2010 Ford F-250/F-350/F-450 6.4L Power Stroke. Integrated 2-micron fuel filter and water separator in one housing, "Whisper Technology" for quieter operation, Mass Flow Return continuous fuel polishing, bolt-on steel bracket mount (no drilling), Limited Lifetime Warranty on the pump body, filter rated for approximately 30,000 miles. MAP pricing.' },
  { id: 'fass-tsf16290g', sku: 'TSF16290G', name: 'FASS Titanium Signature Series 290GPH Lift Pump — 2008-2010 Ford F-250/F-350/F-450 6.4L Power Stroke', platformSlug: 'powerstroke', priceCents: 124982, description: 'FASS Titanium Signature Series lift pump kit, 290 GPH. Fits 2008-2010 Ford F-250/F-350/F-450 6.4L Power Stroke. Integrated 2-micron fuel filter and water separator in one housing, "Whisper Technology" for quieter operation, Mass Flow Return continuous fuel polishing, bolt-on steel bracket mount (no drilling), Limited Lifetime Warranty on the pump body, filter rated for approximately 30,000 miles. MAP pricing.' },
  { id: 'fass-tsf17290f240g', sku: 'TSF17290F240G', name: 'FASS Titanium Signature Series 240GPH Lift Pump — 2011-2016 Ford F-250/F-350/F-450 6.7L Power Stroke', platformSlug: 'powerstroke', priceCents: 124982, description: 'FASS Titanium Signature Series lift pump kit, 240 GPH. Fits 2011-2016 Ford F-250/F-350/F-450 6.7L Power Stroke. Integrated 2-micron fuel filter and water separator in one housing, "Whisper Technology" for quieter operation, Mass Flow Return continuous fuel polishing, bolt-on steel bracket mount (no drilling), Limited Lifetime Warranty on the pump body, filter rated for approximately 30,000 miles. MAP pricing.' },
  { id: 'fass-tsf18250f220g', sku: 'TSF18250F220G', name: 'FASS Titanium Signature Series 220GPH Lift Pump — 2017-2022 Ford F-250/F-350/F-450 6.7L Power Stroke', platformSlug: 'powerstroke', priceCents: 132132, description: 'FASS Titanium Signature Series lift pump kit, 220 GPH. Fits 2017-2022 Ford F-250/F-350/F-450 6.7L Power Stroke. Integrated 2-micron fuel filter and water separator in one housing, "Whisper Technology" for quieter operation, Mass Flow Return continuous fuel polishing, bolt-on steel bracket mount (no drilling), Limited Lifetime Warranty on the pump body, filter rated for approximately 30,000 miles. MAP pricing.' },
  { id: 'fass-tsc08165g', sku: 'TSC08165G', name: 'FASS Titanium Signature Series 165GPH Lift Pump — 1992-2000 GM/Chevrolet 6.5L Turbo Diesel', platformSlug: 'duramax', priceCents: 110682, description: 'FASS Titanium Signature Series lift pump kit, 165 GPH. Fits 1992-2000 GM/Chevrolet 6.5L Turbo Diesel. Integrated 2-micron fuel filter and water separator in one housing, "Whisper Technology" for quieter operation, Mass Flow Return continuous fuel polishing, bolt-on steel bracket mount (no drilling), Limited Lifetime Warranty on the pump body, filter rated for approximately 30,000 miles. MAP pricing.' },
  { id: 'fass-tsc10100g', sku: 'TSC10100G', name: 'FASS Titanium Signature Series 100GPH Lift Pump — 2001-2010 GM/Chevrolet 6.6L Duramax (LB7/LLY/LBZ/LMM)', platformSlug: 'duramax', priceCents: 102102, description: 'FASS Titanium Signature Series lift pump kit, 100 GPH. Fits 2001-2010 GM/Chevrolet 6.6L Duramax (LB7/LLY/LBZ/LMM). Integrated 2-micron fuel filter and water separator in one housing, "Whisper Technology" for quieter operation, Mass Flow Return continuous fuel polishing, bolt-on steel bracket mount (no drilling), Limited Lifetime Warranty on the pump body, filter rated for approximately 30,000 miles. MAP pricing.' },
  { id: 'fass-tsc10165g', sku: 'TSC10165G', name: 'FASS Titanium Signature Series 165GPH Lift Pump — 2001-2010 GM/Chevrolet 6.6L Duramax (LB7/LLY/LBZ/LMM)', platformSlug: 'duramax', priceCents: 107821, description: 'FASS Titanium Signature Series lift pump kit, 165 GPH. Fits 2001-2010 GM/Chevrolet 6.6L Duramax (LB7/LLY/LBZ/LMM). Integrated 2-micron fuel filter and water separator in one housing, "Whisper Technology" for quieter operation, Mass Flow Return continuous fuel polishing, bolt-on steel bracket mount (no drilling), Limited Lifetime Warranty on the pump body, filter rated for approximately 30,000 miles. MAP pricing.' },
  { id: 'fass-tsc14140f110g', sku: 'TSC14140F110G', name: 'FASS Titanium Signature Series 110GPH Lift Pump — 2016-2020 GM Colorado/Canyon 2.8L Duramax', platformSlug: 'duramax', priceCents: 124982, description: 'FASS Titanium Signature Series lift pump kit, 110 GPH. Fits 2016-2020 GM Colorado/Canyon 2.8L Duramax. Integrated 2-micron fuel filter and water separator in one housing, "Whisper Technology" for quieter operation, Mass Flow Return continuous fuel polishing, bolt-on steel bracket mount (no drilling), Limited Lifetime Warranty on the pump body, filter rated for approximately 30,000 miles. MAP pricing.' },
  { id: 'fass-tsc13180f140g', sku: 'TSC13180F140G', name: 'FASS Titanium Signature Series 140GPH Lift Pump — 2017-2019 GM/Chevrolet 6.6L Duramax L5P', platformSlug: 'duramax', priceCents: 117832, description: 'FASS Titanium Signature Series lift pump kit, 140 GPH. Fits 2017-2019 GM/Chevrolet 6.6L Duramax L5P. Integrated 2-micron fuel filter and water separator in one housing, "Whisper Technology" for quieter operation, Mass Flow Return continuous fuel polishing, bolt-on steel bracket mount (no drilling), Limited Lifetime Warranty on the pump body, filter rated for approximately 30,000 miles. MAP pricing.' },
  { id: 'fass-tsc13250f220g', sku: 'TSC13250F220G', name: 'FASS Titanium Signature Series 220GPH Lift Pump — 2017-2019 GM/Chevrolet 6.6L Duramax L5P', platformSlug: 'duramax', priceCents: 124982, description: 'FASS Titanium Signature Series lift pump kit, 220 GPH. Fits 2017-2019 GM/Chevrolet 6.6L Duramax L5P. Integrated 2-micron fuel filter and water separator in one housing, "Whisper Technology" for quieter operation, Mass Flow Return continuous fuel polishing, bolt-on steel bracket mount (no drilling), Limited Lifetime Warranty on the pump body, filter rated for approximately 30,000 miles. MAP pricing.' },
  { id: 'fass-tsd02165g', sku: 'TSD02165G', name: 'FASS Titanium Signature Series 165GPH Lift Pump — 1989-1993 Dodge Ram 5.9L Cummins 12V', platformSlug: 'cummins', priceCents: 106392, description: 'FASS Titanium Signature Series lift pump kit, 165 GPH. Fits 1989-1993 Dodge Ram 5.9L Cummins 12V. Integrated 2-micron fuel filter and water separator in one housing, "Whisper Technology" for quieter operation, Mass Flow Return continuous fuel polishing, bolt-on steel bracket mount (no drilling), Limited Lifetime Warranty on the pump body, filter rated for approximately 30,000 miles. MAP pricing.' },
  { id: 'fass-tsd10290f260g', sku: 'TSD10290F260G', name: 'FASS Titanium Signature Series 260GPH Lift Pump — 1994-1998 Dodge Ram 5.9L Cummins 12V', platformSlug: 'cummins', priceCents: 124982, description: 'FASS Titanium Signature Series lift pump kit, 260 GPH. Fits 1994-1998 Dodge Ram 5.9L Cummins 12V. Integrated 2-micron fuel filter and water separator in one housing, "Whisper Technology" for quieter operation, Mass Flow Return continuous fuel polishing, bolt-on steel bracket mount (no drilling), Limited Lifetime Warranty on the pump body, filter rated for approximately 30,000 miles. MAP pricing.' },
  { id: 'fass-tsd08100g', sku: 'TSD08100G', name: 'FASS Titanium Signature Series 100GPH Lift Pump — 1998.5-2004 Dodge Ram 5.9L Cummins 24V', platformSlug: 'cummins', priceCents: 99243, description: 'FASS Titanium Signature Series lift pump kit, 100 GPH. Fits 1998.5-2004 Dodge Ram 5.9L Cummins 24V. Integrated 2-micron fuel filter and water separator in one housing, "Whisper Technology" for quieter operation, Mass Flow Return continuous fuel polishing, bolt-on steel bracket mount (no drilling), Limited Lifetime Warranty on the pump body, filter rated for approximately 30,000 miles. MAP pricing.' },
  { id: 'fass-tsd08165g', sku: 'TSD08165G', name: 'FASS Titanium Signature Series 165GPH Lift Pump — 1998.5-2004 Dodge Ram 5.9L Cummins 24V', platformSlug: 'cummins', priceCents: 106392, description: 'FASS Titanium Signature Series lift pump kit, 165 GPH. Fits 1998.5-2004 Dodge Ram 5.9L Cummins 24V. Integrated 2-micron fuel filter and water separator in one housing, "Whisper Technology" for quieter operation, Mass Flow Return continuous fuel polishing, bolt-on steel bracket mount (no drilling), Limited Lifetime Warranty on the pump body, filter rated for approximately 30,000 miles. MAP pricing.' },
  { id: 'fass-tsd08250g', sku: 'TSD08250G', name: 'FASS Titanium Signature Series 250GPH Lift Pump — 1998.5-2004.5 Dodge Ram 5.9L Cummins 24V', platformSlug: 'cummins', priceCents: 117832, description: 'FASS Titanium Signature Series lift pump kit, 250 GPH. Fits 1998.5-2004.5 Dodge Ram 5.9L Cummins 24V. Integrated 2-micron fuel filter and water separator in one housing, "Whisper Technology" for quieter operation, Mass Flow Return continuous fuel polishing, bolt-on steel bracket mount (no drilling), Limited Lifetime Warranty on the pump body, filter rated for approximately 30,000 miles. MAP pricing.' },
  { id: 'fass-tsd07100g', sku: 'TSD07100G', name: 'FASS Titanium Signature Series 100GPH Lift Pump — 2005-2024 Dodge/Ram 5.9L/6.7L Cummins', platformSlug: 'cummins', priceCents: 103533, description: 'FASS Titanium Signature Series lift pump kit, 100 GPH. Fits 2005-2024 Dodge/Ram 5.9L/6.7L Cummins. Integrated 2-micron fuel filter and water separator in one housing, "Whisper Technology" for quieter operation, Mass Flow Return continuous fuel polishing, bolt-on steel bracket mount (no drilling), Limited Lifetime Warranty on the pump body, filter rated for approximately 30,000 miles. MAP pricing.' },
  { id: 'fass-tsd07165g', sku: 'TSD07165G', name: 'FASS Titanium Signature Series 165GPH Lift Pump — 2005-2024 Dodge/Ram 5.9L/6.7L Cummins', platformSlug: 'cummins', priceCents: 107821, description: 'FASS Titanium Signature Series lift pump kit, 165 GPH. Fits 2005-2024 Dodge/Ram 5.9L/6.7L Cummins. Integrated 2-micron fuel filter and water separator in one housing, "Whisper Technology" for quieter operation, Mass Flow Return continuous fuel polishing, bolt-on steel bracket mount (no drilling), Limited Lifetime Warranty on the pump body, filter rated for approximately 30,000 miles. MAP pricing.' },
  { id: 'fass-tsd07290g', sku: 'TSD07290G', name: 'FASS Titanium Signature Series 290GPH Lift Pump — 2005-2024 Dodge/Ram 5.9L/6.7L Cummins', platformSlug: 'cummins', priceCents: 124982, description: 'FASS Titanium Signature Series lift pump kit, 290 GPH. Fits 2005-2024 Dodge/Ram 5.9L/6.7L Cummins. Integrated 2-micron fuel filter and water separator in one housing, "Whisper Technology" for quieter operation, Mass Flow Return continuous fuel polishing, bolt-on steel bracket mount (no drilling), Limited Lifetime Warranty on the pump body, filter rated for approximately 30,000 miles. MAP pricing.' },
  { id: 'fass-tsd11140f110g', sku: 'TSD11140F110G', name: 'FASS Titanium Signature Series 110GPH Lift Pump — 2014-2018 Ram 1500 EcoDiesel', platformSlug: 'cummins', priceCents: 124982, description: 'FASS Titanium Signature Series lift pump kit, 110 GPH. Fits 2014-2018 Ram 1500 EcoDiesel. Integrated 2-micron fuel filter and water separator in one housing, "Whisper Technology" for quieter operation, Mass Flow Return continuous fuel polishing, bolt-on steel bracket mount (no drilling), Limited Lifetime Warranty on the pump body, filter rated for approximately 30,000 miles. MAP pricing.' },
];

// ============================================================
// FASS batch 2: Titanium Signature Series PLUS (upgraded internals,
// still a drop-in-tank install) and No-Drop Plus (frame-mounted, skips
// the in-tank pump swap entirely). Same source/pricing basis as batch 1
// above (Dirty Diesel Customs, an authorized FASS dealer at MAP pricing) —
// spot-checked against https://www.dirtydieselcustom.ca/collections/fass-fuel-systems
// before going live. Same INSERT OR IGNORE safety as batch 1: only adds
// missing rows, never overwrites a price/stock/active edit made in Admin.
// ============================================================
const FASS_PLUS_NODROP_PRODUCTS = [
  { id: 'fass-tspc10100g', sku: 'TSPC10100G', name: 'FASS Titanium Signature Series Plus 100GPH Lift Pump — 2001-2010 GM/Chevrolet 6.6L Duramax', platformSlug: 'duramax', priceCents: 105676, description: 'FASS Titanium Signature Series Plus lift pump kit, 100 GPH. Fits 2001-2010 GM/Chevrolet 6.6L Duramax. Upgraded internals over the standard Titanium line for higher-HP tuned trucks, still a drop-in-tank install. Integrated 2-micron fuel filter and water separator, Whisper Technology, Mass Flow Return, Limited Lifetime Warranty. MAP pricing.' },
  { id: 'fass-tspc10250g', sku: 'TSPC10250G', name: 'FASS Titanium Signature Series Plus 250GPH Lift Pump — 2001-2016 GM/Chevrolet 6.6L Duramax', platformSlug: 'duramax', priceCents: 121406, description: 'FASS Titanium Signature Series Plus lift pump kit, 250 GPH. Fits 2001-2016 GM/Chevrolet 6.6L Duramax. Upgraded internals over the standard Titanium line for higher-HP tuned trucks, still a drop-in-tank install. Integrated 2-micron fuel filter and water separator, Whisper Technology, Mass Flow Return, Limited Lifetime Warranty. MAP pricing.' },
  { id: 'fass-tspc10290g', sku: 'TSPC10290G', name: 'FASS Titanium Signature Series Plus 290GPH Lift Pump — 2001-2016 GM/Chevrolet 6.6L Duramax', platformSlug: 'duramax', priceCents: 128558, description: 'FASS Titanium Signature Series Plus lift pump kit, 290 GPH. Fits 2001-2016 GM/Chevrolet 6.6L Duramax. Upgraded internals over the standard Titanium line for higher-HP tuned trucks, still a drop-in-tank install. Integrated 2-micron fuel filter and water separator, Whisper Technology, Mass Flow Return, Limited Lifetime Warranty. MAP pricing.' },
  { id: 'fass-tspc11100g', sku: 'TSPC11100G', name: 'FASS Titanium Signature Series Plus 100GPH Lift Pump — 2011-2014 GM/Chevrolet 6.6L Duramax LML', platformSlug: 'duramax', priceCents: 105676, description: 'FASS Titanium Signature Series Plus lift pump kit, 100 GPH. Fits 2011-2014 GM/Chevrolet 6.6L Duramax LML. Upgraded internals over the standard Titanium line for higher-HP tuned trucks, still a drop-in-tank install. Integrated 2-micron fuel filter and water separator, Whisper Technology, Mass Flow Return, Limited Lifetime Warranty. MAP pricing.' },
  { id: 'fass-tspc11165g', sku: 'TSPC11165G', name: 'FASS Titanium Signature Series Plus 165GPH Lift Pump — 2011-2014 GM/Chevrolet 6.6L Duramax LML', platformSlug: 'duramax', priceCents: 111397, description: 'FASS Titanium Signature Series Plus lift pump kit, 165 GPH. Fits 2011-2014 GM/Chevrolet 6.6L Duramax LML. Upgraded internals over the standard Titanium line for higher-HP tuned trucks, still a drop-in-tank install. Integrated 2-micron fuel filter and water separator, Whisper Technology, Mass Flow Return, Limited Lifetime Warranty. MAP pricing.' },
  { id: 'fass-tspc12100g', sku: 'TSPC12100G', name: 'FASS Titanium Signature Series Plus 100GPH Lift Pump — 2015-2016 GM/Chevrolet 6.6L Duramax LML', platformSlug: 'duramax', priceCents: 107107, description: 'FASS Titanium Signature Series Plus lift pump kit, 100 GPH. Fits 2015-2016 GM/Chevrolet 6.6L Duramax LML. Upgraded internals over the standard Titanium line for higher-HP tuned trucks, still a drop-in-tank install. Integrated 2-micron fuel filter and water separator, Whisper Technology, Mass Flow Return, Limited Lifetime Warranty. MAP pricing.' },
  { id: 'fass-tspc12165g', sku: 'TSPC12165G', name: 'FASS Titanium Signature Series Plus 165GPH Lift Pump — 2015-2016 GM/Chevrolet 6.6L Duramax LML', platformSlug: 'duramax', priceCents: 111397, description: 'FASS Titanium Signature Series Plus lift pump kit, 165 GPH. Fits 2015-2016 GM/Chevrolet 6.6L Duramax LML. Upgraded internals over the standard Titanium line for higher-HP tuned trucks, still a drop-in-tank install. Integrated 2-micron fuel filter and water separator, Whisper Technology, Mass Flow Return, Limited Lifetime Warranty. MAP pricing.' },
  { id: 'fass-tspc13180f140g', sku: 'TSPC13180F140G', name: 'FASS Titanium Signature Series Plus 140GPH Lift Pump — 2017-2019 GM/Chevrolet 6.6L Duramax L5P', platformSlug: 'duramax', priceCents: 121406, description: 'FASS Titanium Signature Series Plus lift pump kit, 140 GPH. Fits 2017-2019 GM/Chevrolet 6.6L Duramax L5P. Upgraded internals over the standard Titanium line for higher-HP tuned trucks, still a drop-in-tank install. Integrated 2-micron fuel filter and water separator, Whisper Technology, Mass Flow Return, Limited Lifetime Warranty. MAP pricing.' },
  { id: 'fass-tspc13290f240g', sku: 'TSPC13290F240G', name: 'FASS Titanium Signature Series Plus 240GPH Lift Pump — 2017-2019 GM/Chevrolet 6.6L Duramax L5P', platformSlug: 'duramax', priceCents: 135707, description: 'FASS Titanium Signature Series Plus lift pump kit, 240 GPH. Fits 2017-2019 GM/Chevrolet 6.6L Duramax L5P. Upgraded internals over the standard Titanium line for higher-HP tuned trucks, still a drop-in-tank install. Integrated 2-micron fuel filter and water separator, Whisper Technology, Mass Flow Return, Limited Lifetime Warranty. MAP pricing.' },
  { id: 'fass-tspc15180f140g', sku: 'TSPC15180F140G', name: 'FASS Titanium Signature Series Plus 140GPH Lift Pump — 2020-2023 GM/Chevrolet 6.6L Duramax L5P', platformSlug: 'duramax', priceCents: 121406, description: 'FASS Titanium Signature Series Plus lift pump kit, 140 GPH. Fits 2020-2023 GM/Chevrolet 6.6L Duramax L5P. Upgraded internals over the standard Titanium line for higher-HP tuned trucks, still a drop-in-tank install. Integrated 2-micron fuel filter and water separator, Whisper Technology, Mass Flow Return, Limited Lifetime Warranty. MAP pricing.' },
  { id: 'fass-tspc15250f220g', sku: 'TSPC15250F220G', name: 'FASS Titanium Signature Series Plus 220GPH Lift Pump — 2020-2023 GM/Chevrolet 6.6L Duramax L5P', platformSlug: 'duramax', priceCents: 128558, description: 'FASS Titanium Signature Series Plus lift pump kit, 220 GPH. Fits 2020-2023 GM/Chevrolet 6.6L Duramax L5P. Upgraded internals over the standard Titanium line for higher-HP tuned trucks, still a drop-in-tank install. Integrated 2-micron fuel filter and water separator, Whisper Technology, Mass Flow Return, Limited Lifetime Warranty. MAP pricing.' },
  { id: 'fass-tspc15290f240g', sku: 'TSPC15290F240G', name: 'FASS Titanium Signature Series Plus 240GPH Lift Pump — 2020-2023 GM/Chevrolet 6.6L Duramax L5P', platformSlug: 'duramax', priceCents: 135707, description: 'FASS Titanium Signature Series Plus lift pump kit, 240 GPH. Fits 2020-2023 GM/Chevrolet 6.6L Duramax L5P. Upgraded internals over the standard Titanium line for higher-HP tuned trucks, still a drop-in-tank install. Integrated 2-micron fuel filter and water separator, Whisper Technology, Mass Flow Return, Limited Lifetime Warranty. MAP pricing.' },
  { id: 'fass-tspd02100g', sku: 'TSPD02100G', name: 'FASS Titanium Signature Series Plus 100GPH Lift Pump — 1989-1993 Dodge Ram 5.9L Cummins 12V', platformSlug: 'cummins', priceCents: 102817, description: 'FASS Titanium Signature Series Plus lift pump kit, 100 GPH. Fits 1989-1993 Dodge Ram 5.9L Cummins 12V. Upgraded internals over the standard Titanium line for higher-HP tuned trucks, still a drop-in-tank install. Integrated 2-micron fuel filter and water separator, Whisper Technology, Mass Flow Return, Limited Lifetime Warranty. MAP pricing.' },
  { id: 'fass-tspd02165g', sku: 'TSPD02165G', name: 'FASS Titanium Signature Series Plus 165GPH Lift Pump — 1989-1993 Dodge Ram 5.9L Cummins 12V', platformSlug: 'cummins', priceCents: 109966, description: 'FASS Titanium Signature Series Plus lift pump kit, 165 GPH. Fits 1989-1993 Dodge Ram 5.9L Cummins 12V. Upgraded internals over the standard Titanium line for higher-HP tuned trucks, still a drop-in-tank install. Integrated 2-micron fuel filter and water separator, Whisper Technology, Mass Flow Return, Limited Lifetime Warranty. MAP pricing.' },
  { id: 'fass-tspd10180f140g', sku: 'TSPD10180F140G', name: 'FASS Titanium Signature Series Plus 140GPH Lift Pump — 1994-1998 Dodge Ram 5.9L Cummins 12V', platformSlug: 'cummins', priceCents: 117118, description: 'FASS Titanium Signature Series Plus lift pump kit, 140 GPH. Fits 1994-1998 Dodge Ram 5.9L Cummins 12V. Upgraded internals over the standard Titanium line for higher-HP tuned trucks, still a drop-in-tank install. Integrated 2-micron fuel filter and water separator, Whisper Technology, Mass Flow Return, Limited Lifetime Warranty. MAP pricing.' },
  { id: 'fass-tspd10250f240g', sku: 'TSPD10250F240G', name: 'FASS Titanium Signature Series Plus 240GPH Lift Pump — 1994-1998 Dodge Ram 5.9L Cummins 12V', platformSlug: 'cummins', priceCents: 121406, description: 'FASS Titanium Signature Series Plus lift pump kit, 240 GPH. Fits 1994-1998 Dodge Ram 5.9L Cummins 12V. Upgraded internals over the standard Titanium line for higher-HP tuned trucks, still a drop-in-tank install. Integrated 2-micron fuel filter and water separator, Whisper Technology, Mass Flow Return, Limited Lifetime Warranty. MAP pricing.' },
  { id: 'fass-tspd10290f260g', sku: 'TSPD10290F260G', name: 'FASS Titanium Signature Series Plus 260GPH Lift Pump — 1994-1998 Dodge Ram 5.9L Cummins 12V', platformSlug: 'cummins', priceCents: 128558, description: 'FASS Titanium Signature Series Plus lift pump kit, 260 GPH. Fits 1994-1998 Dodge Ram 5.9L Cummins 12V. Upgraded internals over the standard Titanium line for higher-HP tuned trucks, still a drop-in-tank install. Integrated 2-micron fuel filter and water separator, Whisper Technology, Mass Flow Return, Limited Lifetime Warranty. MAP pricing.' },
  { id: 'fass-tspd08100g', sku: 'TSPD08100G', name: 'FASS Titanium Signature Series Plus 100GPH Lift Pump — 1998.5-2004 Dodge Ram 5.9L Cummins 24V', platformSlug: 'cummins', priceCents: 102817, description: 'FASS Titanium Signature Series Plus lift pump kit, 100 GPH. Fits 1998.5-2004 Dodge Ram 5.9L Cummins 24V. Upgraded internals over the standard Titanium line for higher-HP tuned trucks, still a drop-in-tank install. Integrated 2-micron fuel filter and water separator, Whisper Technology, Mass Flow Return, Limited Lifetime Warranty. MAP pricing.' },
  { id: 'fass-tspd08165g', sku: 'TSPD08165G', name: 'FASS Titanium Signature Series Plus 165GPH Lift Pump — 1998.5-2004 Dodge Ram 5.9L Cummins 24V', platformSlug: 'cummins', priceCents: 109966, description: 'FASS Titanium Signature Series Plus lift pump kit, 165 GPH. Fits 1998.5-2004 Dodge Ram 5.9L Cummins 24V. Upgraded internals over the standard Titanium line for higher-HP tuned trucks, still a drop-in-tank install. Integrated 2-micron fuel filter and water separator, Whisper Technology, Mass Flow Return, Limited Lifetime Warranty. MAP pricing.' },
  { id: 'fass-tspd07165g', sku: 'TSPD07165G', name: 'FASS Titanium Signature Series Plus 165GPH Lift Pump — 2005-2018 & 2021-2024 Dodge/Ram 5.9L/6.7L Cummins', platformSlug: 'cummins', priceCents: 111397, description: 'FASS Titanium Signature Series Plus lift pump kit, 165 GPH. Fits 2005-2018 & 2021-2024 Dodge/Ram 5.9L/6.7L Cummins. Upgraded internals over the standard Titanium line for higher-HP tuned trucks, still a drop-in-tank install. Integrated 2-micron fuel filter and water separator, Whisper Technology, Mass Flow Return, Limited Lifetime Warranty. MAP pricing.' },
  { id: 'fass-tspf14250f220g', sku: 'TSPF14250F220G', name: 'FASS Titanium Signature Series Plus 220GPH Lift Pump — 1999-2007 Ford F-250/F-350/F-450 7.3L/6.0L Power Stroke', platformSlug: 'powerstroke', priceCents: 121406, description: 'FASS Titanium Signature Series Plus lift pump kit, 220 GPH. Fits 1999-2007 Ford F-250/F-350/F-450 7.3L/6.0L Power Stroke. Upgraded internals over the standard Titanium line for higher-HP tuned trucks, still a drop-in-tank install. Integrated 2-micron fuel filter and water separator, Whisper Technology, Mass Flow Return, Limited Lifetime Warranty. MAP pricing.' },
  { id: 'fass-tspf14290f240g', sku: 'TSPF14290F240G', name: 'FASS Titanium Signature Series Plus 240GPH Lift Pump — 1999-2007 Ford F-250/F-350/F-450 7.3L/6.0L Power Stroke', platformSlug: 'powerstroke', priceCents: 128558, description: 'FASS Titanium Signature Series Plus lift pump kit, 240 GPH. Fits 1999-2007 Ford F-250/F-350/F-450 7.3L/6.0L Power Stroke. Upgraded internals over the standard Titanium line for higher-HP tuned trucks, still a drop-in-tank install. Integrated 2-micron fuel filter and water separator, Whisper Technology, Mass Flow Return, Limited Lifetime Warranty. MAP pricing.' },
  { id: 'fass-tspf17180f140g', sku: 'TSPF17180F140G', name: 'FASS Titanium Signature Series Plus 140GPH Lift Pump — 2011-2016 Ford F-250/F-350/F-450 6.7L Power Stroke', platformSlug: 'powerstroke', priceCents: 115687, description: 'FASS Titanium Signature Series Plus lift pump kit, 140 GPH. Fits 2011-2016 Ford F-250/F-350/F-450 6.7L Power Stroke. Upgraded internals over the standard Titanium line for higher-HP tuned trucks, still a drop-in-tank install. Integrated 2-micron fuel filter and water separator, Whisper Technology, Mass Flow Return, Limited Lifetime Warranty. MAP pricing.' },
  { id: 'fass-ndtspd07165g', sku: 'NDTSPD07165G', name: 'FASS No-Drop Plus 165GPH Lift Pump — 2005-2018 & 2021-2024 Dodge/Ram 5.9L/6.7L Cummins', platformSlug: 'cummins', priceCents: 121406, description: 'FASS No-Drop Plus lift pump kit, 165 GPH. Fits 2005-2018 & 2021-2024 Dodge/Ram 5.9L/6.7L Cummins. Frame-mounted install — no need to drop the fuel tank or touch the factory in-tank pump. Integrated 2-micron fuel filter and water separator, Whisper Technology, Mass Flow Return, Limited Lifetime Warranty. MAP pricing.' },
  { id: 'fass-ndtspc10165g', sku: 'NDTSPC10165G', name: 'FASS No-Drop Plus 165GPH Lift Pump — 2001-2010 GM/Chevrolet 6.6L Duramax', platformSlug: 'duramax', priceCents: 129987, description: 'FASS No-Drop Plus lift pump kit, 165 GPH. Fits 2001-2010 GM/Chevrolet 6.6L Duramax. Frame-mounted install — no need to drop the fuel tank or touch the factory in-tank pump. Integrated 2-micron fuel filter and water separator, Whisper Technology, Mass Flow Return, Limited Lifetime Warranty. MAP pricing.' },
  { id: 'fass-ndtspd07100g', sku: 'NDTSPD07100G', name: 'FASS No-Drop Plus 100GPH Lift Pump — 2005-2018 & 2021-2024 Dodge/Ram 5.9L/6.7L Cummins', platformSlug: 'cummins', priceCents: 117118, description: 'FASS No-Drop Plus lift pump kit, 100 GPH. Fits 2005-2018 & 2021-2024 Dodge/Ram 5.9L/6.7L Cummins. Frame-mounted install — no need to drop the fuel tank or touch the factory in-tank pump. Integrated 2-micron fuel filter and water separator, Whisper Technology, Mass Flow Return, Limited Lifetime Warranty. MAP pricing.' },
  { id: 'fass-ndtspc10100g', sku: 'NDTSPC10100G', name: 'FASS No-Drop Plus 100GPH Lift Pump — 2001-2010 GM/Chevrolet 6.6L Duramax', platformSlug: 'duramax', priceCents: 124267, description: 'FASS No-Drop Plus lift pump kit, 100 GPH. Fits 2001-2010 GM/Chevrolet 6.6L Duramax. Frame-mounted install — no need to drop the fuel tank or touch the factory in-tank pump. Integrated 2-micron fuel filter and water separator, Whisper Technology, Mass Flow Return, Limited Lifetime Warranty. MAP pricing.' },
  { id: 'fass-ndtspf14180f140g', sku: 'NDTSPF14180F140G', name: 'FASS No-Drop Plus 140GPH Lift Pump — 1999-2007 Ford F-250/F-350/F-450 7.3L/6.0L Power Stroke', platformSlug: 'powerstroke', priceCents: 127127, description: 'FASS No-Drop Plus lift pump kit, 140 GPH. Fits 1999-2007 Ford F-250/F-350/F-450 7.3L/6.0L Power Stroke. Frame-mounted install — no need to drop the fuel tank or touch the factory in-tank pump. Integrated 2-micron fuel filter and water separator, Whisper Technology, Mass Flow Return, Limited Lifetime Warranty. MAP pricing.' },
  { id: 'fass-ndtspc11100g', sku: 'NDTSPC11100G', name: 'FASS No-Drop Plus 100GPH Lift Pump — 2011-2014 GM/Chevrolet 6.6L Duramax LML', platformSlug: 'duramax', priceCents: 124267, description: 'FASS No-Drop Plus lift pump kit, 100 GPH. Fits 2011-2014 GM/Chevrolet 6.6L Duramax LML. Frame-mounted install — no need to drop the fuel tank or touch the factory in-tank pump. Integrated 2-micron fuel filter and water separator, Whisper Technology, Mass Flow Return, Limited Lifetime Warranty. MAP pricing.' },
  { id: 'fass-ndtspd08165g', sku: 'NDTSPD08165G', name: 'FASS No-Drop Plus 165GPH Lift Pump — 1998.5-2004 Dodge Ram 5.9L Cummins 24V', platformSlug: 'cummins', priceCents: 128558, description: 'FASS No-Drop Plus lift pump kit, 165 GPH. Fits 1998.5-2004 Dodge Ram 5.9L Cummins 24V. Frame-mounted install — no need to drop the fuel tank or touch the factory in-tank pump. Integrated 2-micron fuel filter and water separator, Whisper Technology, Mass Flow Return, Limited Lifetime Warranty. MAP pricing.' },
  { id: 'fass-ndtspc11165g', sku: 'NDTSPC11165G', name: 'FASS No-Drop Plus 165GPH Lift Pump — 2011-2014 GM/Chevrolet 6.6L Duramax LML', platformSlug: 'duramax', priceCents: 129987, description: 'FASS No-Drop Plus lift pump kit, 165 GPH. Fits 2011-2014 GM/Chevrolet 6.6L Duramax LML. Frame-mounted install — no need to drop the fuel tank or touch the factory in-tank pump. Integrated 2-micron fuel filter and water separator, Whisper Technology, Mass Flow Return, Limited Lifetime Warranty. MAP pricing.' },
  { id: 'fass-ndtspc12100g', sku: 'NDTSPC12100G', name: 'FASS No-Drop Plus 100GPH Lift Pump — 2015-2016 GM/Chevrolet 6.6L Duramax LML', platformSlug: 'duramax', priceCents: 121406, description: 'FASS No-Drop Plus lift pump kit, 100 GPH. Fits 2015-2016 GM/Chevrolet 6.6L Duramax LML. Frame-mounted install — no need to drop the fuel tank or touch the factory in-tank pump. Integrated 2-micron fuel filter and water separator, Whisper Technology, Mass Flow Return, Limited Lifetime Warranty. MAP pricing.' },
  { id: 'fass-ndtspf16250g', sku: 'NDTSPF16250G', name: 'FASS No-Drop Plus 250GPH Lift Pump — 2008-2010 Ford F-250/F-350/F-450 6.4L Power Stroke', platformSlug: 'powerstroke', priceCents: 132846, description: 'FASS No-Drop Plus lift pump kit, 250 GPH. Fits 2008-2010 Ford F-250/F-350/F-450 6.4L Power Stroke. Frame-mounted install — no need to drop the fuel tank or touch the factory in-tank pump. Integrated 2-micron fuel filter and water separator, Whisper Technology, Mass Flow Return, Limited Lifetime Warranty. MAP pricing.' },
  { id: 'fass-ndtspf16290g', sku: 'NDTSPF16290G', name: 'FASS No-Drop Plus 290GPH Lift Pump — 2008-2010 Ford F-250/F-350/F-450 6.4L Power Stroke', platformSlug: 'powerstroke', priceCents: 139998, description: 'FASS No-Drop Plus lift pump kit, 290 GPH. Fits 2008-2010 Ford F-250/F-350/F-450 6.4L Power Stroke. Frame-mounted install — no need to drop the fuel tank or touch the factory in-tank pump. Integrated 2-micron fuel filter and water separator, Whisper Technology, Mass Flow Return, Limited Lifetime Warranty. MAP pricing.' },
  { id: 'fass-ndtspf17250f220g', sku: 'NDTSPF17250F220G', name: 'FASS No-Drop Plus 220GPH Lift Pump — 2011-2016 Ford F-250/F-350/F-450 6.7L Power Stroke', platformSlug: 'powerstroke', priceCents: 132846, description: 'FASS No-Drop Plus lift pump kit, 220 GPH. Fits 2011-2016 Ford F-250/F-350/F-450 6.7L Power Stroke. Frame-mounted install — no need to drop the fuel tank or touch the factory in-tank pump. Integrated 2-micron fuel filter and water separator, Whisper Technology, Mass Flow Return, Limited Lifetime Warranty. MAP pricing.' },
  { id: 'fass-ndtspf18180f140g', sku: 'NDTSPF18180F140G', name: 'FASS No-Drop Plus 140GPH Lift Pump — 2017-2022 Ford F-250/F-350/F-450 6.7L Power Stroke', platformSlug: 'powerstroke', priceCents: 138567, description: 'FASS No-Drop Plus lift pump kit, 140 GPH. Fits 2017-2022 Ford F-250/F-350/F-450 6.7L Power Stroke. Frame-mounted install — no need to drop the fuel tank or touch the factory in-tank pump. Integrated 2-micron fuel filter and water separator, Whisper Technology, Mass Flow Return, Limited Lifetime Warranty. MAP pricing.' },
  { id: 'fass-ndtspf18250f220g', sku: 'NDTSPF18250F220G', name: 'FASS No-Drop Plus 220GPH Lift Pump — 2017-2022 Ford F-250/F-350/F-450 6.7L Power Stroke', platformSlug: 'powerstroke', priceCents: 145717, description: 'FASS No-Drop Plus lift pump kit, 220 GPH. Fits 2017-2022 Ford F-250/F-350/F-450 6.7L Power Stroke. Frame-mounted install — no need to drop the fuel tank or touch the factory in-tank pump. Integrated 2-micron fuel filter and water separator, Whisper Technology, Mass Flow Return, Limited Lifetime Warranty. MAP pricing.' },
  { id: 'fass-ndtspf18290f240g', sku: 'NDTSPF18290F240G', name: 'FASS No-Drop Plus 240GPH Lift Pump — 2017-2022 Ford F-250/F-350/F-450 6.7L Power Stroke', platformSlug: 'powerstroke', priceCents: 152867, description: 'FASS No-Drop Plus lift pump kit, 240 GPH. Fits 2017-2022 Ford F-250/F-350/F-450 6.7L Power Stroke. Frame-mounted install — no need to drop the fuel tank or touch the factory in-tank pump. Integrated 2-micron fuel filter and water separator, Whisper Technology, Mass Flow Return, Limited Lifetime Warranty. MAP pricing.' },
  { id: 'fass-ndtspf20180f140g', sku: 'NDTSPF20180F140G', name: 'FASS No-Drop Plus 140GPH Lift Pump — 2023-2024 Ford F-250/F-350/F-450 6.7L Power Stroke', platformSlug: 'powerstroke', priceCents: 152867, description: 'FASS No-Drop Plus lift pump kit, 140 GPH. Fits 2023-2024 Ford F-250/F-350/F-450 6.7L Power Stroke. Frame-mounted install — no need to drop the fuel tank or touch the factory in-tank pump. Integrated 2-micron fuel filter and water separator, Whisper Technology, Mass Flow Return, Limited Lifetime Warranty. MAP pricing.' },
  { id: 'fass-ndtspf20250f220g', sku: 'NDTSPF20250F220G', name: 'FASS No-Drop Plus 220GPH Lift Pump — 2023-2024 Ford F-250/F-350/F-450 6.7L Power Stroke', platformSlug: 'powerstroke', priceCents: 157157, description: 'FASS No-Drop Plus lift pump kit, 220 GPH. Fits 2023-2024 Ford F-250/F-350/F-450 6.7L Power Stroke. Frame-mounted install — no need to drop the fuel tank or touch the factory in-tank pump. Integrated 2-micron fuel filter and water separator, Whisper Technology, Mass Flow Return, Limited Lifetime Warranty. MAP pricing.' },
  { id: 'fass-ndtspf20290f240g', sku: 'NDTSPF20290F240G', name: 'FASS No-Drop Plus 240GPH Lift Pump — 2023-2024 Ford F-250/F-350/F-450 6.7L Power Stroke', platformSlug: 'powerstroke', priceCents: 164306, description: 'FASS No-Drop Plus lift pump kit, 240 GPH. Fits 2023-2024 Ford F-250/F-350/F-450 6.7L Power Stroke. Frame-mounted install — no need to drop the fuel tank or touch the factory in-tank pump. Integrated 2-micron fuel filter and water separator, Whisper Technology, Mass Flow Return, Limited Lifetime Warranty. MAP pricing.' },
];

// ============================================================
// DCC (Diesel Cartel Canada) house-brand turbochargers — universal
// frame-size units (not tied to one truck/year the way the FASS
// pumps are), sized for custom big-single or compound builds across
// Cummins/Duramax/Power Stroke. Priced from CAD-converted USD specs
// (today's rate + a 5% buffer for rate drift/card fees), regular
// (non-sale) pricing basis. Listed under brand "DCC" only — no
// third-party brand name attached, per house-brand naming.
// Same INSERT OR IGNORE safety as the FASS batches: only adds
// missing rows, never overwrites a price/stock/active edit made in
// Admin -> Products on a later deploy.
// ============================================================
const DCC_TURBO_PRODUCTS = [
  { id: 'dcc-turbo-7265', sku: 'DCCT7265', name: 'DCC Billet Turbocharger — 72/65mm Compressor/Turbine Wheel', priceCents: 58130, weightLbs: 14, description: 'DCC billet turbocharger, 72/65mm compressor and turbine wheel combination. Billet compressor wheel for improved airflow and durability over cast alternatives. Sized for mild-to-moderate power builds. This is a universal-fit frame-size turbo installed as part of a custom turbo system — not a direct bolt-on replacement — so pair it with the appropriate manifold, oil/coolant lines, and downpipe for your specific Cummins, Duramax, or Power Stroke build.' },
  { id: 'dcc-turbo-75-8375', sku: 'DCCT7583', name: 'DCC Billet Turbocharger — 75mm, 83×75mm Wheel, 1.10 AR T4 Divided', priceCents: 72699, weightLbs: 17, description: 'DCC billet turbocharger, 75mm compressor with an 83×75mm turbine wheel. T4 divided turbine housing, 1.10 A/R. Divided housing helps maintain exhaust pulse separation for better spool on divided-manifold setups. Universal frame-size unit for custom single or compound turbo systems — not a direct bolt-on replacement.' },
  { id: 'dcc-turbo-7875', sku: 'DCCT7875NG', name: 'DCC Billet Turbocharger — Next Gen 78/75mm', priceCents: 109121, weightLbs: 19, description: 'DCC Next Gen billet turbocharger, 78mm compressor / 75mm turbine — one of the most common mid-size frames used in diesel truck big-single and compound builds. Billet compressor wheel construction. Universal frame-size unit for custom turbo systems; pair with the correct manifold, housing, and plumbing for your platform.' },
  { id: 'dcc-turbo-80-8375', sku: 'DCCT8083', name: 'DCC Billet Turbocharger — 80mm, 83×75mm Wheel, 1.10 AR T4 Divided', priceCents: 87267, weightLbs: 21, description: 'DCC billet turbocharger, 80mm compressor with an 83×75mm turbine wheel. T4 divided turbine housing, 1.10 A/R. A step up in flow from the 75mm frame for bigger power targets while keeping a divided housing for pulse-separated manifolds. Universal frame-size unit — not a direct bolt-on replacement.' },
  { id: 'dcc-turbo-88-9688', sku: 'DCCT8896DV', name: 'DCC Billet Turbocharger — 88mm, 96×88mm Wheel, Dual V-Band, 1.30 AR', priceCents: 164482, weightLbs: 27, description: 'DCC billet turbocharger, 88mm compressor with a 96×88mm turbine wheel. Dual V-band housings (compressor and turbine) for easier install/removal in a custom system, 1.30 A/R turbine housing. Large-frame unit suited to big-single setups or as the atmosphere (top) stage of a compound system. Universal frame-size unit — not a direct bolt-on replacement.' },
  { id: 'dcc-turbo-88-103', sku: 'DCCT88103NG', name: 'DCC Billet Turbocharger — Next Gen 88/103mm, 1.58 AR', priceCents: 203818, weightLbs: 31, description: 'DCC Next Gen billet turbocharger, 88/103mm compressor wheel, 1.58 A/R turbine housing. Extra-large frame sized for serious big-single or compound builds chasing higher airflow. Universal frame-size unit for custom turbo systems — not a direct bolt-on replacement.' },
  { id: 'dcc-turbo-88-gt50', sku: 'DCCT88GT50', name: 'DCC Ball Bearing Turbocharger — 88mm/GT50, T6 Housing, 1.24 AR', priceCents: 291231, weightLbs: 29, description: 'DCC ball bearing turbocharger, 88mm/GT50-class compressor wheel, T6 turbine housing, 1.24 A/R. Ball bearing center cartridge for quicker spool response versus a journal-bearing unit of the same size. Extra-large frame for big-single or compound race/tow builds. Universal frame-size unit — not a direct bolt-on replacement.' },
  { id: 'dcc-turbo-94-113', sku: 'DCCT94113', name: 'DCC Billet Turbocharger — 94/113mm, T6 Housing, 1.24 AR', priceCents: 334938, weightLbs: 36, description: 'DCC billet turbocharger, 94/113mm compressor wheel, T6 turbine housing, 1.24 A/R. The largest frame in the DCC turbo lineup — built for serious compound/big-single race and heavy-tow applications chasing maximum airflow. Universal frame-size unit for custom turbo systems — not a direct bolt-on replacement.' },
  { id: 'dcc-turbo-6973', sku: 'DCCT6973', name: 'DCC Billet Turbocharger — 69/73mm, 0.91 AR T4 Divided', priceCents: 98923, weightLbs: 25, description: 'DCC billet turbocharger, 69mm compressor with a 73mm turbine wheel (80/73 turbine option also available). T4 divided turbine housing, 0.91 A/R, 4" Marmon discharge outlet. Rated for roughly 950 hp at the flywheel. Universal frame-size unit for custom turbo systems — not a direct bolt-on replacement.' },
  { id: 'dcc-turbo-6773-t4', sku: 'DCCT6773T4', name: 'DCC Dual Ball Bearing Turbocharger — 67.7mm, T4 Divided, 1.01 AR', priceCents: 149914, weightLbs: 34, description: 'DCC dual ceramic ball bearing turbocharger, 67.7mm compressor wheel, T4 divided turbine housing, 1.01 A/R. Ball bearing center cartridge for quicker spool response. Smallest frame in this series, suited to lower-lag big-single or compound builds. Universal frame-size unit for custom turbo systems — not a direct bolt-on replacement.' },
  { id: 'dcc-turbo-72-t4', sku: 'DCCT72T4', name: 'DCC Dual Ball Bearing Turbocharger — 72mm, T4 Divided, 1.01 AR', priceCents: 149914, weightLbs: 34, description: 'DCC dual ceramic ball bearing turbocharger, 72mm compressor wheel, T4 divided turbine housing, 1.01 A/R. Ball bearing center cartridge for quicker spool response. Mid frame in this series for a broader power range. Universal frame-size unit for custom turbo systems — not a direct bolt-on replacement.' },
  { id: 'dcc-turbo-76-t4', sku: 'DCCT76T4', name: 'DCC Dual Ball Bearing Turbocharger — 76mm, T4 Divided, 1.01 AR', priceCents: 149914, weightLbs: 34, description: 'DCC dual ceramic ball bearing turbocharger, 76mm compressor wheel, T4 divided turbine housing, 1.01 A/R. Ball bearing center cartridge for quicker spool response. Step up in flow from the 72mm frame for bigger power targets. Universal frame-size unit for custom turbo systems — not a direct bolt-on replacement.' },
  { id: 'dcc-turbo-80-t4', sku: 'DCCT80T4', name: 'DCC Dual Ball Bearing Turbocharger — 80mm, T4 Divided, 1.01 AR', priceCents: 149914, weightLbs: 34, description: 'DCC dual ceramic ball bearing turbocharger, 80mm compressor wheel, T4 divided turbine housing, 1.01 A/R. Ball bearing center cartridge for quicker spool response. Largest frame in this series for serious big-single or compound race/tow builds. Universal frame-size unit for custom turbo systems — not a direct bolt-on replacement.' },
];

export function seedDccTurbos() {
  // Same timing guard as the FASS seed below: this runs at db.js
  // import time, which can be before seed.js has inserted its own
  // (more complete) 'turbochargers' category row.
  db.prepare(`
    INSERT OR IGNORE INTO categories (slug, name, blurb, icon)
    VALUES ('turbochargers', 'Turbochargers', 'Turbos, manifolds, and boost components', 'turbo')
  `).run();

  const insert = db.prepare(`
    INSERT OR IGNORE INTO products
      (id, sku, name, brand, category_slug, platform_slug, price_cents, description, weight_lbs, supplier, active, stock_qty)
    VALUES
      (@id, @sku, @name, 'DCC', 'turbochargers', 'universal', @priceCents, @description, @weightLbs, NULL, 1, 3)
  `);
  let inserted = 0;
  for (const p of DCC_TURBO_PRODUCTS) {
    try {
      const info = insert.run(p);
      if (info.changes > 0) inserted++;
    } catch (err) {
      console.error('[seedDccTurbos] insert failed for', p.id, '-', err.message);
    }
  }

  const updateName = db.prepare(`UPDATE products SET name = @name WHERE id = @id AND brand = 'DCC'`);
  for (const p of DCC_TURBO_PRODUCTS) {
    try {
      updateName.run({ id: p.id, name: p.name });
    } catch (err) {
      console.error('[seedDccTurbos] update failed for', p.id, '-', err.message);
    }
  }

  const dccCount = db.prepare(`SELECT COUNT(*) AS c FROM products WHERE brand = 'DCC'`).get().c;
  console.log(`[seedDccTurbos] inserted ${inserted}/${DCC_TURBO_PRODUCTS.length} new rows this run; ${dccCount} DCC rows total in DB now.`);
}

// ============================================================
// P1 Race Products (P1RP) — Canadian-made diesel exhaust systems.
// Cody is an authorized P1RP dealer; prices below are P1RP's own
// listed CAD pricing (they're already a Canadian company, so no
// USD->CAD conversion or markup is applied here — same "use the
// real listed price" approach as the FASS batches). Compiled from
// p1rp.com's own product catalog (144 of their ~172 listed items —
// EGR/CCV delete kits, "Power Bundle" combo packages, and apparel
// were left out as out-of-scope for a straight parts catalog).
// Listed under the real "P1RP" brand name since this is a genuine
// supplier relationship, unlike the reference-only DCC turbo batch.
// Same INSERT OR IGNORE safety as the other batches: only adds
// missing rows, never overwrites a price/stock/active edit made in
// Admin -> Products on a later deploy. weight_lbs intentionally left
// NULL here (not collected in this pass) — checkout.js already falls
// back to a per-category shipping estimate when weight is unset.
// ============================================================
const P1RP_EXHAUST_PRODUCTS = [
  // === Cummins (RAM/Dodge 5.9L/6.7L, 12V/24V) ===
  { id: 'p1rp-s6126plm', sku: 'S6126PLM', name: '2004.5-2007 RAM Cummins 2500/3500 "600/610" 4" Turbo Back w/o Muffler', platformSlug: 'cummins', priceCents: 64999, description: 'A 4-inch turbo-back exhaust system without a muffler for 2004.5-2007 RAM Cummins 2500/3500 trucks.' },
  { id: 'p1rp-s6126slm', sku: 'S6126SLM', name: '2004.5-2007 RAM Cummins 2500/3500 "600/610" 4" Turbo Back w/o Muffler T409', platformSlug: 'cummins', priceCents: 101999, description: 'T409 stainless steel 4-inch turbo-back exhaust system without a muffler for 2004.5-2007 RAM Cummins 2500/3500 trucks.' },
  { id: 'p1rp-s6126p', sku: 'S6126P', name: '2004.5-2007 RAM Cummins 2500/3500 "600/610" 4" Turbo Back with Muffler', platformSlug: 'cummins', priceCents: 89999, description: '4-inch turbo-back exhaust system with muffler for 2004.5-2007 RAM Cummins 2500/3500 trucks.' },
  { id: 'p1rp-s61160plm', sku: 'S61160PLM', name: '2004.5-2009 RAM Cummins 2500/3500 "600/610" 5" Turbo Back w/o Muffler', platformSlug: 'cummins', priceCents: 91999, description: '5-inch turbo-back exhaust system without a muffler for 2004.5-2009 RAM Cummins 2500/3500 trucks.' },
  { id: 'p1rp-s61160slm', sku: 'S61160SLM', name: '2004.5-2009 RAM Cummins 2500/3500 "600/610" 5" Turbo Back w/o Muffler T409', platformSlug: 'cummins', priceCents: 129999, description: 'T409 stainless steel 5-inch turbo-back exhaust system without a muffler for 2004.5-2009 RAM Cummins 2500/3500 trucks.' },
  { id: 'p1rp-s61160p', sku: 'S61160P', name: '2004.5-2009 RAM Cummins 2500/3500 "600/610" 5" Turbo Back with Muffler', platformSlug: 'cummins', priceCents: 97999, description: '5-inch turbo-back exhaust system with muffler for 2004.5-2009 RAM Cummins 2500/3500 trucks.' },
  { id: 'p1rp-c6126p', sku: 'C6126P', name: '2007-2009 Cummins 2500/3500 4" Turbo Back with Muffler', platformSlug: 'cummins', priceCents: 79999, description: '4-inch turbo-back exhaust system with muffler for 2007-2009 RAM Cummins 2500/3500 trucks.' },
  { id: 'p1rp-c6116plm', sku: 'C6116PLM', name: '2007-2009 Cummins 2500/3500 5" Turbo Back w/o Muffler', platformSlug: 'cummins', priceCents: 89999, description: '5-inch turbo-back exhaust system without a muffler for 2007-2009 RAM Cummins 2500/3500 trucks.' },
  { id: 'p1rp-c6126plm', sku: 'C6126PLM', name: '2007-2009 RAM Cummins 2500/3500 4" Turbo Back w/o Muffler', platformSlug: 'cummins', priceCents: 64999, description: '4-inch turbo-back exhaust system without a muffler for 2007-2009 RAM Cummins 2500/3500 trucks.' },
  { id: 'p1rp-cdal439', sku: 'CDAL439', name: '2007-2012 RAM Cummins 2500/3500 4" Down pipe', platformSlug: 'cummins', priceCents: 37999, description: '4-inch aluminized downpipe for 2007-2012 RAM Cummins 2500/3500 trucks.' },
  { id: 'p1rp-cds9439', sku: 'CDS9439', name: '2007-2012 RAM Cummins 2500/3500 4" Down pipe T409', platformSlug: 'cummins', priceCents: 47999, description: 'T409 stainless steel 4-inch downpipe for 2007-2012 RAM Cummins 2500/3500 trucks.' },
  { id: 'p1rp-cdal437', sku: 'CDAL437', name: '2007-2012 RAM Cummins 2500/3500 4" Race Pipe', platformSlug: 'cummins', priceCents: 28999, description: '4-inch off-road race pipe (muffler delete) for 2007-2012 RAM Cummins 2500/3500 trucks.' },
  { id: 'p1rp-cdal443', sku: 'CDAL443', name: '2007.5-2012 RAM Cummins 2500/3500 4" Race Pipe with Muffler', platformSlug: 'cummins', priceCents: 51999, description: '4-inch race pipe with muffler for 2007.5-2012 RAM Cummins 2500/3500 trucks.' },
  { id: 'p1rp-c6142p', sku: 'C6142P', name: '2010-2012 RAM Cummins 2500/3500 - 4" Turbo Back with Muffler', platformSlug: 'cummins', priceCents: 84999, description: '4-inch turbo-back exhaust system with muffler for 2010-2012 RAM Cummins 2500/3500 trucks.' },
  { id: 'p1rp-c6146plm', sku: 'C6146PLM', name: '2010-2012 RAM Cummins 2500/3500 5" Turbo Back w/o Muffler', platformSlug: 'cummins', priceCents: 89999, description: '5-inch turbo-back exhaust system without a muffler for 2010-2012 RAM Cummins 2500/3500 trucks.' },
  { id: 'p1rp-c6146p', sku: 'C6146P', name: '2010-2012 RAM Cummins 2500/3500 5" Turbo Back with Muffler', platformSlug: 'cummins', priceCents: 99999, description: '5-inch turbo-back exhaust system with muffler for 2010-2012 RAM Cummins 2500/3500 trucks.' },
  { id: 'p1rp-cdal441', sku: 'CDAL441', name: '2013-2018 RAM Cummins 2500/3500 4" Race Pipe', platformSlug: 'cummins', priceCents: 38999, description: '4-inch off-road race pipe (muffler delete) for 2013-2018 RAM Cummins 2500/3500 trucks.' },
  { id: 'p1rp-cdal442', sku: 'CDAL442', name: '2013-2018 RAM Cummins 2500/3500 4" Race Pipe with Muffler', platformSlug: 'cummins', priceCents: 46999, description: '4-inch race pipe with muffler for 2013-2018 RAM Cummins 2500/3500 trucks.' },
  { id: 'p1rp-cds9442', sku: 'CDS9442', name: '2013-2018 RAM Cummins 2500/3500 4" Race Pipe with Muffler T409', platformSlug: 'cummins', priceCents: 67999, description: 'T409 stainless steel 4-inch race pipe with muffler for 2013-2018 RAM Cummins 2500/3500 trucks.' },
  { id: 'p1rp-c6145p', sku: 'C6145P', name: '2013-2018 RAM Cummins 2500/3500 4" Turbo Back with Muffler', platformSlug: 'cummins', priceCents: 82999, description: '4-inch turbo-back exhaust system with muffler for 2013-2018 RAM Cummins 2500/3500 trucks.' },
  { id: 'p1rp-c6145plm', sku: 'C6145PLM', name: '2013-2018 RAM Cummins 2500/3500 4" Turbo Back w/o Muffler', platformSlug: 'cummins', priceCents: 70999, description: '4-inch turbo-back exhaust system without a muffler for 2013-2018 RAM Cummins 2500/3500 trucks.' },
  { id: 'p1rp-c6145slm', sku: 'C6145SLM', name: '2013-2018 RAM Cummins 2500/3500 4" Turbo Back w/o Muffler T409', platformSlug: 'cummins', priceCents: 97999, description: 'T409 stainless steel 4-inch turbo-back exhaust system without a muffler for 2013-2018 RAM Cummins 2500/3500 trucks.' },
  { id: 'p1rp-c6147plm', sku: 'C6147PLM', name: '2013-2018 RAM Cummins 2500/3500 5" Turbo Back w/o Muffler', platformSlug: 'cummins', priceCents: 90999, description: '5-inch turbo-back exhaust system without a muffler for 2013-2018 RAM Cummins 2500/3500 trucks.' },
  { id: 'p1rp-c6147slm', sku: 'C6147SLM', name: '2013-2018 RAM Cummins 2500/3500 5" Turbo Back w/o Muffler T409', platformSlug: 'cummins', priceCents: 134999, description: 'T409 stainless steel 5-inch turbo-back exhaust system without a muffler for 2013-2018 RAM Cummins 2500/3500 trucks.' },
  { id: 'p1rp-c6147p', sku: 'C6147P', name: '2013-2018 RAM Cummins 2500/3500 5" Turbo Back with Muffler', platformSlug: 'cummins', priceCents: 101999, description: '5-inch turbo-back exhaust system with muffler for 2013-2018 RAM Cummins 2500/3500 trucks.' },
  { id: 'p1rp-cdal444', sku: 'CDAL444', name: '2013-2018 RAM Cummins 3500/4500/5500 Cab & Chassis 4" Race Pipe', platformSlug: 'cummins', priceCents: 52999, description: '4-inch off-road race pipe for 2013-2018 RAM Cummins 3500/4500/5500 cab & chassis trucks.' },
  { id: 'p1rp-c6149p', sku: 'C6149P', name: '2019-2024 RAM Cummins 2500/3500 4" Down Pipe Back with Muffler', platformSlug: 'cummins', priceCents: 81999, description: '4-inch down-pipe-back exhaust system with muffler for 2019-2024 RAM Cummins 2500/3500 trucks.' },
  { id: 'p1rp-cdal447', sku: 'CDAL447', name: '2019-2024 RAM Cummins 2500/3500 4" Race Pipe', platformSlug: 'cummins', priceCents: 39999, description: '4-inch off-road race pipe for 2019-2024 RAM Cummins 2500/3500 trucks.' },
  { id: 'p1rp-cds9447', sku: 'CDS9447', name: '2019-2024 RAM Cummins 2500/3500 4" Race Pipe T409', platformSlug: 'cummins', priceCents: 54999, description: 'T409 stainless steel 4-inch off-road race pipe for 2019-2024 RAM Cummins 2500/3500 trucks.' },
  { id: 'p1rp-cdal448', sku: 'CDAL448', name: '2019-2024 RAM Cummins 2500/3500 4" Race Pipe with Muffler', platformSlug: 'cummins', priceCents: 51999, description: '4-inch race pipe with muffler for 2019-2024 RAM Cummins 2500/3500 trucks.' },
  { id: 'p1rp-cds9448', sku: 'CDS9448', name: '2019-2024 RAM Cummins 2500/3500 4" Race Pipe with Muffler T409', platformSlug: 'cummins', priceCents: 72999, description: 'T409 stainless steel 4-inch race pipe with muffler for 2019-2024 RAM Cummins 2500/3500 trucks.' },
  { id: 'p1rp-c6149plm', sku: 'C6149PLM', name: '2019-2024 RAM Cummins 2500/3500 4" Down Pipe Back w/o Muffler', platformSlug: 'cummins', priceCents: 72999, description: '4-inch down-pipe-back exhaust system without a muffler for 2019-2024 RAM Cummins 2500/3500 trucks.' },
  { id: 'p1rp-c6149slm', sku: 'C6149SLM', name: '2019-2024 RAM Cummins 2500/3500 4" Down Pipe Back w/o Muffler T409', platformSlug: 'cummins', priceCents: 97999, description: 'T409 stainless steel 4-inch down-pipe-back exhaust system without a muffler for 2019-2024 RAM Cummins 2500/3500 trucks.' },
  { id: 'p1rp-c6151p', sku: 'C6151P', name: '2019-2024 RAM Cummins 2500/3500 5" Down Pipe Back with Muffler', platformSlug: 'cummins', priceCents: 102999, description: '5-inch down-pipe-back exhaust system with muffler for 2019-2024 RAM Cummins 2500/3500 trucks.' },
  { id: 'p1rp-c6151plm', sku: 'C6151PLM', name: '2019-2024 RAM Cummins 2500/3500 5" Down Pipe Back w/o Muffler', platformSlug: 'cummins', priceCents: 91999, description: '5-inch down-pipe-back exhaust system without a muffler for 2019-2024 RAM Cummins 2500/3500 trucks.' },
  { id: 'p1rp-c6151slm', sku: 'C6151SLM', name: '2019-2024 RAM Cummins 2500/3500 5" Down Pipe Back w/o Muffler T409', platformSlug: 'cummins', priceCents: 129999, description: 'T409 stainless steel 5-inch down-pipe-back exhaust system without a muffler for 2019-2024 RAM Cummins 2500/3500 trucks.' },

  // === Duramax (GM/Chevrolet/GMC 6.6L LB7-L5P) ===
  { id: 'p1rp-c6004plm', sku: 'C6004PLM', name: '2007-2010 GM Duramax 2500/3500 4" Down Pipe Back w/o Muffler', platformSlug: 'duramax', priceCents: 89999, description: '4-inch down-pipe-back exhaust system without a muffler for 2007-2010 GM Duramax 2500/3500 trucks.' },
  { id: 'p1rp-c6004p', sku: 'C6004P', name: '2007-2010 GM Duramax 2500/3500 4" Down Pipe Back with Muffler', platformSlug: 'duramax', priceCents: 95999, description: '4-inch down-pipe-back exhaust system with muffler for 2007-2010 GM Duramax 2500/3500 trucks.' },
  { id: 'p1rp-c6020plm', sku: 'C6020PLM', name: '2007-2010 GM Duramax 2500/3500 5" Down Pipe Back w/o Muffler', platformSlug: 'duramax', priceCents: 94999, description: '5-inch down-pipe-back exhaust system without a muffler for 2007-2010 GM Duramax 2500/3500 trucks.' },
  { id: 'p1rp-c6044plm', sku: 'C6044PLM', name: '2011-2015 GM Duramax 2500/3500 4" Down Pipe Back w/o Muffler', platformSlug: 'duramax', priceCents: 79999, description: '4-inch down-pipe-back exhaust system without a muffler for 2011-2015 GM Duramax 2500/3500 trucks.' },
  { id: 'p1rp-c6044p', sku: 'C6044P', name: '2011-2015 GM Duramax 2500/3500 4" Down Pipe Back with Muffler', platformSlug: 'duramax', priceCents: 85999, description: '4-inch down-pipe-back exhaust system with muffler for 2011-2015 GM Duramax 2500/3500 trucks.' },
  { id: 'p1rp-cgmal426', sku: 'CGMAL426', name: '2011-2015 GM Duramax 2500/3500 4" Race Pipe', platformSlug: 'duramax', priceCents: 47999, description: '4-inch off-road race pipe for 2011-2015 GM Duramax 2500/3500 trucks.' },
  { id: 'p1rp-cgms9426', sku: 'CGMS9426', name: '2011-2015 GM Duramax 2500/3500 4" Race Pipe T409', platformSlug: 'duramax', priceCents: 63999, description: 'T409 stainless steel 4-inch off-road race pipe for 2011-2015 GM Duramax 2500/3500 trucks.' },
  { id: 'p1rp-cgmal432', sku: 'CGMAL432', name: '2011-2015 GM Duramax 2500/3500 4" Race Pipe with Muffler', platformSlug: 'duramax', priceCents: 59999, description: '4-inch race pipe with muffler for 2011-2015 GM Duramax 2500/3500 trucks.' },
  { id: 'p1rp-c6048plm', sku: 'C6048PLM', name: '2011-2015 GM Duramax 2500/3500 5" Down Pipe Back w/o Muffler', platformSlug: 'duramax', priceCents: 89999, description: '5-inch down-pipe-back exhaust system without a muffler for 2011-2015 GM Duramax 2500/3500 trucks.' },
  { id: 'p1rp-c6048slm', sku: 'C6048SLM', name: '2011-2015 GM Duramax 2500/3500 5" Down Pipe Back w/o Muffler T409', platformSlug: 'duramax', priceCents: 124999, description: 'T409 stainless steel 5-inch down-pipe-back exhaust system without a muffler for 2011-2015 GM Duramax 2500/3500 trucks.' },
  { id: 'p1rp-c6045plm', sku: 'C6045PLM', name: '2015.5-2016 GM Duramax 2500/3500 4" Down Pipe Back w/o Muffler', platformSlug: 'duramax', priceCents: 86999, description: '4-inch down-pipe-back exhaust system without a muffler for 2015.5-2016 GM Duramax 2500/3500 trucks.' },
  { id: 'p1rp-c6045slm', sku: 'C6045SLM', name: '2015.5-2016 GM Duramax 2500/3500 4" Down Pipe Back w/o Muffler T409', platformSlug: 'duramax', priceCents: 99999, description: 'T409 stainless steel 4-inch down-pipe-back exhaust system without a muffler for 2015.5-2016 GM Duramax 2500/3500 trucks.' },
  { id: 'p1rp-c6045p', sku: 'C6045P', name: '2015.5-2016 GM Duramax 2500/3500 4" Down Pipe Back with Muffler', platformSlug: 'duramax', priceCents: 92999, description: '4-inch down-pipe-back exhaust system with muffler for 2015.5-2016 GM Duramax 2500/3500 trucks.' },
  { id: 'p1rp-cgmal429', sku: 'CGMAL429', name: '2015.5-2016 GM Duramax 2500/3500 4" Race Pipe', platformSlug: 'duramax', priceCents: 49999, description: '4-inch off-road race pipe for 2015.5-2016 GM Duramax 2500/3500 trucks.' },
  { id: 'p1rp-cgms9429', sku: 'CGMS9429', name: '2015.5-2016 GM Duramax 2500/3500 4" Race Pipe T409', platformSlug: 'duramax', priceCents: 64999, description: 'T409 stainless steel 4-inch off-road race pipe for 2015.5-2016 GM Duramax 2500/3500 trucks.' },
  { id: 'p1rp-cgmal431', sku: 'CGMAL431', name: '2015.5-2016 GM Duramax 2500/3500 4" Race Pipe with Muffler', platformSlug: 'duramax', priceCents: 64999, description: '4-inch race pipe with muffler for 2015.5-2016 GM Duramax 2500/3500 trucks.' },
  { id: 'p1rp-c6049plm', sku: 'C6049PLM', name: '2015.5-2016 GM Duramax 2500/3500 5" Down Pipe Back w/o Muffler', platformSlug: 'duramax', priceCents: 89999, description: '5-inch down-pipe-back exhaust system without a muffler for 2015.5-2016 GM Duramax 2500/3500 trucks.' },
  { id: 'p1rp-c6049p', sku: 'C6049P', name: '2015.5-2016 GM Duramax 2500/3500 5" Down Pipe Back with Muffler', platformSlug: 'duramax', priceCents: 99999, description: '5-inch down-pipe-back exhaust system with muffler for 2015.5-2016 GM Duramax 2500/3500 trucks.' },
  { id: 'p1rp-c6057p', sku: 'C6057P', name: '2016-2018 Chevy/GMC Colorado/Canyon Duramax 3" Turbo Back with Muffler', platformSlug: 'duramax', priceCents: 70999, description: '3-inch turbo-back exhaust system with muffler for 2016-2018 Chevrolet Colorado/GMC Canyon Duramax trucks.' },
  { id: 'p1rp-cgmald17', sku: 'CGMALD17', name: '2017-2026 Duramax 3.5" L5P Downpipe', platformSlug: 'duramax', priceCents: 38999, description: '3.5-inch aluminized downpipe for 2017-2026 GM Duramax L5P trucks.' },
  { id: 'p1rp-cgmal430', sku: 'CGMAL430', name: '2017-2026 GM Duramax 2500/3500 4" Race Pipe', platformSlug: 'duramax', priceCents: 66999, description: '4-inch off-road race pipe for 2017-2026 GM Duramax 2500/3500 trucks.' },
  { id: 'p1rp-c6056plm', sku: 'C6056PLM', name: '2017-2026 GM Duramax 2500/3500 HD Duramax L5P 4" Down Pipe Back w/o Muffler', platformSlug: 'duramax', priceCents: 86999, description: '4-inch down-pipe-back exhaust system without a muffler for 2017-2026 GM Duramax L5P 2500/3500 trucks.' },
  { id: 'p1rp-c6056p', sku: 'C6056P', name: '2017-2026 GM Duramax 2500/3500 HD Duramax L5P 4" Down Pipe Back with Muffler', platformSlug: 'duramax', priceCents: 94999, description: '4-inch down-pipe-back exhaust system with muffler for 2017-2026 GM Duramax L5P 2500/3500 trucks.' },
  { id: 'p1rp-cgmal433', sku: 'CGMAL433', name: '2017-2026 GM Duramax 3500/3500 4" Race Pipe with Muffler', platformSlug: 'duramax', priceCents: 71999, description: '4-inch race pipe with muffler for 2017-2026 GM Duramax L5P trucks.' },
  { id: 'p1rp-c6056slm', sku: 'C6056SLM', name: '2017-2026 GM Duramax 3500/3500 HD Duramax L5P 4" Down Pipe Back w/o Muffler T409', platformSlug: 'duramax', priceCents: 106999, description: 'T409 stainless steel 4-inch down-pipe-back exhaust system without a muffler for 2017-2026 GM Duramax L5P trucks.' },

  // === Powerstroke (Ford 6.0L/6.4L/6.7L/7.3L/3.0L) ===
  { id: 'p1rp-c6254plm', sku: 'C6254PLM', name: '2008-2010 Ford Powerstroke F250/350/450 4" Down Pipe Back w/o Muffler', platformSlug: 'powerstroke', priceCents: 71999, description: '4-inch down-pipe-back exhaust system without a muffler for 2008-2010 Ford Power Stroke F250/350/450 trucks.' },
  { id: 'p1rp-c6254slm', sku: 'C6254SLM', name: '2008-2010 Ford Powerstroke F250/350/450 4" Down Pipe Back w/o Muffler T409', platformSlug: 'powerstroke', priceCents: 91999, description: 'T409 stainless steel 4-inch down-pipe-back exhaust system without a muffler for 2008-2010 Ford Power Stroke F250/350/450 trucks.' },
  { id: 'p1rp-c6270p', sku: 'C6270P', name: '2008-2010 Ford Powerstroke F250/350/450 4" Down Pipe Back with Muffler', platformSlug: 'powerstroke', priceCents: 82999, description: '4-inch down-pipe-back exhaust system with muffler for 2008-2010 Ford Power Stroke F250/350/450 trucks.' },
  { id: 'p1rp-cfal457', sku: 'CFAL457', name: '2008-2010 Ford Powerstroke F250/350/450 4" Race Pipe', platformSlug: 'powerstroke', priceCents: 31999, description: '4-inch off-road race pipe for 2008-2010 Ford Power Stroke F250/350/450 trucks.' },
  { id: 'p1rp-cfs9457', sku: 'CFS9457', name: '2008-2010 Ford Powerstroke F250/350/450 4" Race Pipe T409', platformSlug: 'powerstroke', priceCents: 39999, description: 'T409 stainless steel 4-inch off-road race pipe for 2008-2010 Ford Power Stroke F250/350/450 trucks.' },
  { id: 'p1rp-cfal464', sku: 'CFAL464', name: '2008-2010 Ford Powerstroke F250/350/450 4" Race Pipe with Muffler', platformSlug: 'powerstroke', priceCents: 45999, description: '4-inch race pipe with muffler for 2008-2010 Ford Power Stroke F250/350/450 trucks.' },
  { id: 'p1rp-c6268plm', sku: 'C6268PLM', name: '2008-2010 Ford Powerstroke F250/350/450 5" Down Pipe Back w/o Muffler', platformSlug: 'powerstroke', priceCents: 79999, description: '5-inch down-pipe-back exhaust system without a muffler for 2008-2010 Ford Power Stroke F250/350/450 trucks.' },
  { id: 'p1rp-c6268slm', sku: 'C6268SLM', name: '2008-2010 Ford Powerstroke F250/350/450 5" Down Pipe Back w/o Muffler T409', platformSlug: 'powerstroke', priceCents: 99999, description: 'T409 stainless steel 5-inch down-pipe-back exhaust system without a muffler for 2008-2010 Ford Power Stroke F250/350/450 trucks.' },
  { id: 'p1rp-c6268p', sku: 'C6268P', name: '2008-2010 Ford Powerstroke F250/350/450 5" Down Pipe Back with Muffler', platformSlug: 'powerstroke', priceCents: 94999, description: '5-inch down-pipe-back exhaust system with muffler for 2008-2010 Ford Power Stroke F250/350/450 trucks.' },
  { id: 'p1rp-c6241plm', sku: 'C6241PLM', name: '2008-2010 Ford Powerstroke F250/F350/F450 4" Turbo Back w/o Muffler', platformSlug: 'powerstroke', priceCents: 91999, description: '4-inch turbo-back exhaust system without a muffler for 2008-2010 Ford Power Stroke F250/350/450 trucks.' },
  { id: 'p1rp-c6260plm', sku: 'C6260PLM', name: '2011-2016 Ford Powerstroke F250/350/450 4" Down Pipe Back w/o Muffler', platformSlug: 'powerstroke', priceCents: 69999, description: '4-inch down-pipe-back exhaust system without a muffler for 2011-2016 Ford Power Stroke F250/350/450 trucks.' },
  { id: 'p1rp-c6260slm', sku: 'C6260SLM', name: '2011-2016 Ford Powerstroke F250/350/450 4" Down Pipe Back w/o Muffler T409', platformSlug: 'powerstroke', priceCents: 91999, description: 'T409 stainless steel 4-inch down-pipe-back exhaust system without a muffler for 2011-2016 Ford Power Stroke F250/350/450 trucks.' },
  { id: 'p1rp-c6262p', sku: 'C6262P', name: '2011-2016 Ford Powerstroke F250/350/450 4" Down Pipe Back with Muffler', platformSlug: 'powerstroke', priceCents: 92999, description: '4-inch down-pipe-back exhaust system with muffler for 2011-2016 Ford Power Stroke F250/350/450 trucks.' },
  { id: 'p1rp-cfal458', sku: 'CFAL458', name: '2011-2016 Ford Powerstroke F250/350/450 4" Race Pipe', platformSlug: 'powerstroke', priceCents: 38999, description: '4-inch off-road race pipe for 2011-2016 Ford Power Stroke F250/350/450 trucks.' },
  { id: 'p1rp-cfs9458', sku: 'CFS9458', name: '2011-2016 Ford Powerstroke F250/350/450 4" Race Pipe T409', platformSlug: 'powerstroke', priceCents: 49999, description: 'T409 stainless steel 4-inch off-road race pipe for 2011-2016 Ford Power Stroke F250/350/450 trucks.' },
  { id: 'p1rp-cfal462', sku: 'CFAL462', name: '2011-2016 Ford Powerstroke F250/350/450 4" Race Pipe with Muffler', platformSlug: 'powerstroke', priceCents: 51999, description: '4-inch race pipe with muffler for 2011-2016 Ford Power Stroke F250/350/450 trucks.' },
  { id: 'p1rp-c6280plm', sku: 'C6280PLM', name: '2011-2019 Ford Powerstroke F250/350/450 5" Down Pipe Back w/o Muffler', platformSlug: 'powerstroke', priceCents: 92999, description: '5-inch down-pipe-back exhaust system without a muffler for 2011-2019 Ford Power Stroke F250/350/450 trucks.' },
  { id: 'p1rp-c6280slm', sku: 'C6280SLM', name: '2011-2019 Ford Powerstroke F250/350/450 5" Down Pipe Back w/o Muffler T409', platformSlug: 'powerstroke', priceCents: 119999, description: 'T409 stainless steel 5-inch down-pipe-back exhaust system without a muffler for 2011-2019 Ford Power Stroke F250/350/450 trucks.' },
  { id: 'p1rp-c6292slm', sku: 'C6292SLM', name: '2017-2019 Ford Powerstroke F250/350/450 4" Down Pipe Back w/o Muffler T409', platformSlug: 'powerstroke', priceCents: 91999, description: 'T409 stainless steel 4-inch down-pipe-back exhaust system without a muffler for 2017-2019 Ford Power Stroke F250/350/450 trucks.' },
  { id: 'p1rp-c6292p', sku: 'C6292P', name: '2017-2019 Ford Powerstroke F250/350/450 4" Down Pipe Back with Muffler', platformSlug: 'powerstroke', priceCents: 86999, description: '4-inch down-pipe-back exhaust system with muffler for 2017-2019 Ford Power Stroke F250/350/450 trucks.' },
  { id: 'p1rp-c6292plm', sku: 'C6292PLM', name: '2017-2019 Ford Powerstroke F250/350/450 4" Down Pipe Back w/o Muffler', platformSlug: 'powerstroke', priceCents: 71999, description: '4-inch down-pipe-back exhaust system without a muffler for 2017-2019 Ford Power Stroke F250/350/450 trucks.' },
  { id: 'p1rp-cfal461', sku: 'CFAL461', name: '2017-2019 Ford Powerstroke F250/350/450 4" Race Pipe', platformSlug: 'powerstroke', priceCents: 38999, description: '4-inch off-road race pipe for 2017-2019 Ford Power Stroke F250/350/450 trucks.' },
  { id: 'p1rp-cfs9461', sku: 'CFS9461', name: '2017-2019 Ford Powerstroke F250/350/450 4" Race Pipe T409', platformSlug: 'powerstroke', priceCents: 51999, description: 'T409 stainless steel 4-inch off-road race pipe for 2017-2019 Ford Power Stroke F250/350/450 trucks.' },
  { id: 'p1rp-cfal463', sku: 'CFAL463', name: '2017-2019 Ford Powerstroke F250/350/450 4" Race Pipe with Muffler', platformSlug: 'powerstroke', priceCents: 51999, description: '4-inch race pipe with muffler for 2017-2019 Ford Power Stroke F250/350/450 trucks.' },
  { id: 'p1rp-c6294plm', sku: 'C6294PLM', name: '2018-2019 Ford F150 3.0L Powerstroke 3.5" Turbo Back w/o Muffler', platformSlug: 'powerstroke', priceCents: 65999, description: '3.5-inch turbo-back exhaust system without a muffler for 2018-2019 Ford F150 3.0L Power Stroke trucks.' },
  { id: 'p1rp-c6294p', sku: 'C6294P', name: '2018-2019 Ford F150 3.0L Powerstroke 3.5" Turbo Back with Muffler', platformSlug: 'powerstroke', priceCents: 74999, description: '3.5-inch turbo-back exhaust system with muffler for 2018-2019 Ford F150 3.0L Power Stroke trucks.' },
  { id: 'p1rp-cfal465', sku: 'CFAL465', name: '2018-2019 Ford F150 Powerstroke 3.5" Race Pipe', platformSlug: 'powerstroke', priceCents: 39999, description: '3.5-inch off-road race pipe for 2018-2019 Ford F150 Power Stroke trucks.' },
  { id: 'p1rp-c6293slm', sku: 'C6293SLM', name: '2020-2026 F250/350/450 6.7L Powerstroke 4" Stainless Turbo Back No Muffler', platformSlug: 'powerstroke', priceCents: 89999, description: 'T304 stainless steel 4-inch turbo-back exhaust system without a muffler for 2020-2026 Ford F250/350/450 6.7L Power Stroke trucks.' },
  { id: 'p1rp-c6293plm', sku: 'C6293PLM', name: '2020-2026 F250/350/450 6.7L Powerstroke 4" Turbo Back No Muffler', platformSlug: 'powerstroke', priceCents: 79999, description: '4-inch turbo-back exhaust system without a muffler for 2020-2026 Ford F250/350/450 6.7L Power Stroke trucks.' },
  { id: 'p1rp-c6281slm', sku: 'C6281SLM', name: '2020-2026 Ford F250/350/450 5" Stainless Turbo Back Exhaust - No Muffler', platformSlug: 'powerstroke', priceCents: 114999, description: 'T304 stainless steel 5-inch turbo-back exhaust system without a muffler for 2020-2026 Ford F250/350/450 Power Stroke trucks.' },
  { id: 'p1rp-c6281plm', sku: 'C6281PLM', name: '2020-2026 Ford F250/350/450 5" Turbo Back Exhaust - No Muffler', platformSlug: 'powerstroke', priceCents: 99999, description: '5-inch turbo-back exhaust system without a muffler for 2020-2026 Ford F250/350/450 Power Stroke trucks.' },
  { id: 'p1rp-c6281p', sku: 'C6281P', name: '2020-2026 Ford F250/350/450 5" Turbo Back Exhaust - With Muffler', platformSlug: 'powerstroke', priceCents: 109999, description: '5-inch turbo-back exhaust system with muffler for 2020-2026 Ford F250/350/450 Power Stroke trucks.' },
  { id: 'p1rp-cfal466', sku: 'CFAL466', name: '2020-2026 Ford Powerstroke F250/350/450 4" Race Pipe', platformSlug: 'powerstroke', priceCents: 42999, description: '4-inch off-road race pipe for 2020-2026 Ford Power Stroke F250/350/450 trucks.' },
  { id: 'p1rp-cfald20', sku: 'CFALD20', name: '2023-2026 Ford F250/350/450 DownPipe', platformSlug: 'powerstroke', priceCents: 39999, description: 'Aluminized downpipe for 2023-2026 Ford F250/350/450 Power Stroke trucks.' },

  // === Universal (EcoDiesel, Sprinter, Titan XD, Jeep, and non-vehicle-specific tips) ===
  { id: 'p1rp-c6301slm', sku: 'C6301SLM', name: '2010-2018 Mercedes Benz Sprinter 3" Stainless Turbo Back Race System', platformSlug: 'universal', priceCents: 69999, description: 'T304 stainless steel 3-inch turbo-back race exhaust system for 2010-2018 Mercedes-Benz Sprinter vans.' },
  { id: 'p1rp-c6301plm', sku: 'C6301PLM', name: '2010-2018 Mercedes Benz Sprinter 3" Turbo Back Race System w/o Muffler', platformSlug: 'universal', priceCents: 51999, description: '3-inch turbo-back race exhaust system without a muffler for 2010-2018 Mercedes-Benz Sprinter vans.' },
  { id: 'p1rp-cdal446', sku: 'CDAL446', name: '2014-2018 RAM 1500 3.0L EcoDiesel 3" Race Pipe', platformSlug: 'universal', priceCents: 35999, description: '3-inch off-road race pipe for 2014-2018 RAM 1500 3.0L EcoDiesel trucks.' },
  { id: 'p1rp-cds9446', sku: 'CDS9446', name: '2014-2018 RAM 1500 EcoDiesel 3" Race Pipe T409', platformSlug: 'universal', priceCents: 55999, description: 'T409 stainless steel 3-inch off-road race pipe for 2014-2018 RAM 1500 EcoDiesel trucks.' },
  { id: 'p1rp-cnal401', sku: 'CNAL401', name: '2016-2019 Nissan Titan XD 4" Race Pipe', platformSlug: 'universal', priceCents: 45999, description: '4-inch off-road race pipe for 2016-2019 Nissan Titan XD trucks.' },
  { id: 'p1rp-cjal401', sku: 'CJAL401', name: '2021-2023 Jeep Gladiator 3.0L EcoDiesel 3" Race Pipe', platformSlug: 'universal', priceCents: 49999, description: '3-inch off-road race pipe for 2021-2023 Jeep Gladiator 3.0L EcoDiesel trucks.' },
  { id: 'p1rp-cjs9401', sku: 'CJS9401', name: '2021-2023 Jeep Gladiator 3.0L EcoDiesel 3" Race Pipe T409', platformSlug: 'universal', priceCents: 56999, description: 'T409 stainless steel 3-inch off-road race pipe for 2021-2023 Jeep Gladiator 3.0L EcoDiesel trucks.' },

  // === P1RP / MBRP exhaust tips (universal, bolt-on) ===
  { id: 'p1rp-t5049', sku: 'T5049', name: 'Diesel Exhaust Tip - 4" Inlet - 5" OD - Armor Pro', platformSlug: 'universal', priceCents: 11999, description: 'T304 stainless steel polished bolt-on exhaust tip with a 4-inch inlet and 5-inch outlet.' },
  { id: 'p1rp-t5050', sku: 'T5050', name: 'Diesel Exhaust Tip - 4" Inlet - 5" OD - Armor Pro', platformSlug: 'universal', priceCents: 9999, description: 'T304 stainless steel polished bolt-on exhaust tip with a 4-inch inlet and 5-inch outlet.' },
  { id: 'p1rp-t5051', sku: 'T5051', name: 'Diesel Exhaust Tip - 4" Inlet - 5" OD - Armor Pro', platformSlug: 'universal', priceCents: 8999, description: 'T304 stainless steel polished bolt-on exhaust tip with a 4-inch inlet and 5-inch outlet.' },
  { id: 'p1rp-t5051blk', sku: 'T5051BLK', name: 'Black Coated Diesel Exhaust Tip - 4" Inlet - 5" OD - Armor BLK', platformSlug: 'universal', priceCents: 10999, description: 'Black-coated stainless steel bolt-on exhaust tip with a 4-inch inlet and 5-inch outlet.' },
  { id: 'p1rp-t5052', sku: 'T5052', name: 'Diesel Exhaust Tip - 4" Inlet - 5" OD - Armor Pro', platformSlug: 'universal', priceCents: 9499, description: 'T304 stainless steel polished bolt-on exhaust tip with a 4-inch inlet and 5-inch outlet.' },
  { id: 'p1rp-t5053', sku: 'T5053', name: 'Diesel Exhaust Tip - 4" Inlet - 5" OD - Armor Pro', platformSlug: 'universal', priceCents: 10999, description: 'T304 stainless steel polished bolt-on exhaust tip with a 4-inch inlet and 5-inch outlet.' },
  { id: 'p1rp-t5053blk', sku: 'T5053BLK', name: 'Black Coated Diesel Exhaust Tip - 4" Inlet - 5" OD - Armor BLK', platformSlug: 'universal', priceCents: 12999, description: 'Black-coated stainless steel bolt-on exhaust tip with a 4-inch inlet and 5-inch outlet.' },
  { id: 'p1rp-t5072', sku: 'T5072', name: 'Diesel Exhaust Tip - 4" Inlet - 6" OD - Armor Pro', platformSlug: 'universal', priceCents: 13499, description: 'T304 stainless steel polished bolt-on exhaust tip with a 4-inch inlet and 6-inch outlet.' },
  { id: 'p1rp-t5072blk', sku: 'T5072BLK', name: 'Black Coated Diesel Exhaust Tip - 4" Inlet - 6" OD - Armor BLK', platformSlug: 'universal', priceCents: 16999, description: 'Black-coated stainless steel bolt-on exhaust tip with a 4-inch inlet and 6-inch outlet.' },
  { id: 'p1rp-t5072cf', sku: 'T5072CF', name: 'Carbon Fiber Diesel Exhaust Tip - 4" Inlet - 6" OD', platformSlug: 'universal', priceCents: 39999, description: 'Carbon-fiber-wrapped stainless bolt-on exhaust tip with a 4-inch inlet and 6-inch outlet.' },
  { id: 'p1rp-t5073', sku: 'T5073', name: 'Diesel Exhaust Tip - 4" Inlet - 6" OD - Armor Pro', platformSlug: 'universal', priceCents: 12999, description: 'T304 stainless steel polished bolt-on exhaust tip with a 4-inch inlet and 6-inch outlet.' },
  { id: 'p1rp-t5074', sku: 'T5074', name: 'Diesel Exhaust Tip - 5" Inlet - 6" OD - Armor Pro', platformSlug: 'universal', priceCents: 13499, description: 'T304 stainless steel polished bolt-on exhaust tip with a 5-inch inlet and 6-inch outlet.' },
  { id: 'p1rp-t5074blk', sku: 'T5074BLK', name: 'Black Coated Diesel Exhaust Tip - 5" Inlet - 6" OD - Armor BLK', platformSlug: 'universal', priceCents: 16499, description: 'Black-coated stainless steel bolt-on exhaust tip with a 5-inch inlet and 6-inch outlet.' },
  { id: 'p1rp-t5075', sku: 'T5075', name: 'Diesel Exhaust Tip - 5" Inlet - 6" OD - Armor Pro', platformSlug: 'universal', priceCents: 11999, description: 'T304 stainless steel polished bolt-on exhaust tip with a 5-inch inlet and 6-inch outlet.' },
  { id: 'p1rp-t5075blk', sku: 'T5075BLK', name: 'Black Coated Diesel Exhaust Tip - 5" Inlet - 6" OD - Armor BLK', platformSlug: 'universal', priceCents: 12999, description: 'Black-coated stainless steel bolt-on exhaust tip with a 5-inch inlet and 6-inch outlet.' },
  { id: 'p1rp-t5075cf', sku: 'T5075CF', name: 'Carbon Fiber Diesel Exhaust Tip - 5" Inlet - 6" OD', platformSlug: 'universal', priceCents: 39999, description: 'Carbon-fiber-wrapped stainless bolt-on exhaust tip with a 5-inch inlet and 6-inch outlet.' },
  { id: 'p1rp-t5081', sku: 'T5081', name: 'Diesel Exhaust Tip - 4" Inlet - 4" OD - Armor Pro', platformSlug: 'universal', priceCents: 9999, description: 'T304 stainless steel polished bolt-on exhaust tip with a 4-inch inlet and 4-inch outlet.' },
  { id: 'p1rp-t5085', sku: 'T5085', name: 'Diesel Exhaust Tip - 5" Inlet - 5" OD - Armor Pro', platformSlug: 'universal', priceCents: 13499, description: 'T304 stainless steel polished bolt-on exhaust tip with a 5-inch inlet and 5-inch outlet.' },
  { id: 'p1rp-t5086', sku: 'T5086', name: 'Diesel Exhaust Tip - 4" Inlet - 5" OD - Armor Pro', platformSlug: 'universal', priceCents: 14999, description: 'T304 stainless steel polished bolt-on exhaust tip with a 4-inch inlet and 5-inch outlet.' },
  { id: 'p1rp-t5110', sku: 'T5110', name: 'Diesel Exhaust Tip - 4" Inlet - 4" OD - Armor Pro', platformSlug: 'universal', priceCents: 9999, description: 'T304 stainless steel polished bolt-on exhaust tip with a 4-inch inlet and 4-inch outlet.' },
  { id: 'p1rp-t5111blk', sku: 'T5111BLK', name: 'Black Coated Diesel Exhaust Tip - 4" Inlet - Armor BLK', platformSlug: 'universal', priceCents: 19999, description: 'Black-coated stainless steel bolt-on exhaust tip with a 4-inch inlet.' },
  { id: 'p1rp-t5124', sku: 'T5124', name: 'Diesel Exhaust Tip - 4" Inlet - 5" OD - Armor Pro', platformSlug: 'universal', priceCents: 12999, description: 'T304 stainless steel polished bolt-on exhaust tip with a 4-inch inlet and 5-inch outlet.' },
  { id: 'p1rp-t5124blk', sku: 'T5124BLK', name: 'Black Coated Diesel Exhaust Tip - 4" Inlet - 5" OD - Armor BLK', platformSlug: 'universal', priceCents: 14999, description: 'Black-coated stainless steel bolt-on exhaust tip with a 4-inch inlet and 5-inch outlet.' },
  { id: 'p1rp-t5125', sku: 'T5125', name: 'Diesel Exhaust Tip - 5" Inlet - 6" OD - Armor Pro', platformSlug: 'universal', priceCents: 16999, description: 'T304 stainless steel polished bolt-on exhaust tip with a 5-inch inlet and 6-inch outlet.' },
  { id: 'p1rp-t5125blk', sku: 'T5125BLK', name: 'Black Coated Diesel Exhaust Tip - 5" Inlet - 6" OD - Armor BLK', platformSlug: 'universal', priceCents: 17999, description: 'Black-coated stainless steel bolt-on exhaust tip with a 5-inch inlet and 6-inch outlet.' },
  { id: 'p1rp-t5126', sku: 'T5126', name: 'Diesel Exhaust Tip - 4" Inlet - 7" OD - Armor Pro', platformSlug: 'universal', priceCents: 20499, description: 'T304 stainless steel polished bolt-on exhaust tip with a 4-inch inlet and 7-inch outlet.' },
  { id: 'p1rp-t5126blk', sku: 'T5126BLK', name: 'Black Coated Diesel Exhaust Tip - 4" Inlet - 7" OD - Armor BLK', platformSlug: 'universal', priceCents: 21999, description: 'Black-coated stainless steel bolt-on exhaust tip with a 4-inch inlet and 7-inch outlet.' },
  { id: 'p1rp-t5127', sku: 'T5127', name: 'Diesel Exhaust Tip - 5" Inlet - 7" OD - Armor Pro', platformSlug: 'universal', priceCents: 20999, description: 'T304 stainless steel polished bolt-on exhaust tip with a 5-inch inlet and 7-inch outlet.' },
  { id: 'p1rp-t5127blk', sku: 'T5127BLK', name: 'Black Coated Diesel Exhaust Tip - 5" Inlet - 7" OD - Armor BLK', platformSlug: 'universal', priceCents: 22499, description: 'Black-coated stainless steel bolt-on exhaust tip with a 5-inch inlet and 7-inch outlet.' },
  { id: 'p1rp-t5128', sku: 'T5128', name: 'Diesel Exhaust Tip - 4" Inlet - 8" OD - Armor Pro', platformSlug: 'universal', priceCents: 21999, description: 'T304 stainless steel polished bolt-on exhaust tip with a 4-inch inlet and 8-inch outlet.' },
  { id: 'p1rp-t5128blk', sku: 'T5128BLK', name: 'Black Coated Diesel Exhaust Tip - 4" Inlet - 8" OD - Armor BLK', platformSlug: 'universal', priceCents: 25499, description: 'Black-coated stainless steel bolt-on exhaust tip with a 4-inch inlet and 8-inch outlet.' },
  { id: 'p1rp-t5129', sku: 'T5129', name: 'Diesel Exhaust Tip - 5" Inlet - 8" OD - Armor Pro', platformSlug: 'universal', priceCents: 21999, description: 'T304 stainless steel polished bolt-on exhaust tip with a 5-inch inlet and 8-inch outlet.' },
  { id: 'p1rp-t5129blk', sku: 'T5129BLK', name: 'Black Coated Diesel Exhaust Tip - 5" Inlet - 8" OD - Armor BLK', platformSlug: 'universal', priceCents: 24999, description: 'Black-coated stainless steel bolt-on exhaust tip with a 5-inch inlet and 8-inch outlet.' },
  { id: 'p1rp-t5130', sku: 'T5130', name: 'Diesel Exhaust Tip - 4" Inlet - 6" OD - Armor Pro', platformSlug: 'universal', priceCents: 16999, description: 'T304 stainless steel polished bolt-on exhaust tip with a 4-inch inlet and 6-inch outlet.' },
  { id: 'p1rp-t5130blk', sku: 'T5130BLK', name: 'Black Coated Diesel Exhaust Tip - 4" Inlet - 6" OD - Armor BLK', platformSlug: 'universal', priceCents: 18999, description: 'Black-coated stainless steel bolt-on exhaust tip with a 4-inch inlet and 6-inch outlet.' },
  { id: 'p1rp-t5154', sku: 'T5154', name: 'Diesel Exhaust Tip - 5" Inlet - 6" OD - Armor Pro', platformSlug: 'universal', priceCents: 20999, description: 'T304 stainless steel polished bolt-on exhaust tip with a 5-inch inlet and 6-inch outlet.' },
  { id: 'p1rp-t5154blk', sku: 'T5154BLK', name: 'Black Coated Diesel Exhaust Tip - 5" Inlet - 6" OD - Armor BLK', platformSlug: 'universal', priceCents: 21499, description: 'Black-coated stainless steel bolt-on exhaust tip with a 5-inch inlet and 6-inch outlet.' },
  { id: 'p1rp-t5164blk', sku: 'T5164BLK', name: 'Black Coated Diesel Exhaust Tip - 4" Inlet - 5" OD - Armor BLK', platformSlug: 'universal', priceCents: 19999, description: 'Black-coated stainless steel bolt-on exhaust tip with a 4-inch inlet and 5-inch outlet.' },
  { id: 'p1rp-t5165blk', sku: 'T5165BLK', name: 'Black Coated Diesel Exhaust Tip - 4" Inlet - 5" OD - Armor BLK', platformSlug: 'universal', priceCents: 18999, description: 'Black-coated stainless steel bolt-on exhaust tip with a 4-inch inlet and 5-inch outlet.' },
  { id: 'p1rp-t5166blk', sku: 'T5166BLK', name: 'Black Coated Diesel Exhaust Tip - 5" Inlet - 6" OD - Armor BLK', platformSlug: 'universal', priceCents: 23499, description: 'Black-coated stainless steel bolt-on exhaust tip with a 5-inch inlet and 6-inch outlet.' },
  { id: 'p1rp-t5167blk', sku: 'T5167BLK', name: 'Black Coated Diesel Exhaust Tip - 5" Inlet - 6" OD - Armor BLK', platformSlug: 'universal', priceCents: 22499, description: 'Black-coated stainless steel bolt-on exhaust tip with a 5-inch inlet and 6-inch outlet.' },
  { id: 'p1rp-t5169blk', sku: 'T5169BLK', name: 'Black Coated Diesel Exhaust Tip - 4" Inlet - 4" OD - Armor BLK', platformSlug: 'universal', priceCents: 14999, description: 'Black-coated stainless steel bolt-on exhaust tip with a 4-inch inlet and 4-inch outlet.' },
];

export function seedP1rp() {
  db.prepare(`
    INSERT OR IGNORE INTO categories (slug, name, blurb, icon)
    VALUES ('exhaust', 'Exhaust Systems', 'Downpipes, turbo-back & cat-back kits', 'exhaust')
  `).run();

  const insert = db.prepare(`
    INSERT OR IGNORE INTO products
      (id, sku, name, brand, category_slug, platform_slug, price_cents, description, weight_lbs, supplier, active, stock_qty)
    VALUES
      (@id, @sku, @name, 'P1RP', 'exhaust', @platformSlug, @priceCents, @description, NULL, 'P1 Race Products (authorized dealer)', 1, 3)
  `);
  let inserted = 0;
  for (const p of P1RP_EXHAUST_PRODUCTS) {
    try {
      const info = insert.run(p);
      if (info.changes > 0) inserted++;
    } catch (err) {
      console.error('[seedP1rp] insert failed for', p.id, '-', err.message);
    }
  }

  const updateName = db.prepare(`UPDATE products SET name = @name WHERE id = @id AND brand = 'P1RP'`);
  for (const p of P1RP_EXHAUST_PRODUCTS) {
    try {
      updateName.run({ id: p.id, name: p.name });
    } catch (err) {
      console.error('[seedP1rp] update failed for', p.id, '-', err.message);
    }
  }

  const p1rpCount = db.prepare(`SELECT COUNT(*) AS c FROM products WHERE brand = 'P1RP'`).get().c;
  console.log(`[seedP1rp] inserted ${inserted}/${P1RP_EXHAUST_PRODUCTS.length} new rows this run; ${p1rpCount} P1RP rows total in DB now.`);
}

// ------------------------------------------------------------------
// P1RP product photos. Sourced directly from each product's own
// individual page on p1rp.com (their collection/category grid pages
// proved unreliable — many tiles there serve stale, shared lazy-load
// placeholder images reused across totally unrelated products, so
// only a product's own page can be trusted). Every URL below was
// confirmed on that exact product's page. SKUs NOT in this map are
// intentionally left without a photo — either p1rp.com had no
// distinct/reliable image for that item, or it couldn't be confirmed
// — rather than risk showing the wrong picture; the storefront falls
// back to a category icon for those. This only ever fills in an
// empty image_url (see seedP1rpImages below), so it never overwrites
// a photo set later by hand in Admin -> Products.
// ------------------------------------------------------------------
const P1RP_IMAGE_MAP = {
  // Cummins
  S6126PLM: 'https://p1rp.com/cdn/shop/files/S6126PLM.jpg?v=1749660289',
  S6126SLM: 'https://p1rp.com/cdn/shop/files/S6126SLM.jpg?v=1749660288',
  S6126P: 'https://p1rp.com/cdn/shop/files/S6126P.jpg?v=1749660290',
  S61160PLM: 'https://p1rp.com/cdn/shop/files/S6126PLM_c208d0ad-d06f-4693-9edc-91d8a68febeb.jpg?v=1749660291',
  S61160SLM: 'https://p1rp.com/cdn/shop/files/S6126SLM_f8dd945f-c494-4656-8073-c4b69dfa33b5.jpg?v=1749660291',
  S61160P: 'https://p1rp.com/cdn/shop/files/S61160P.jpg?v=1749660292',
  C6126P: 'https://p1rp.com/cdn/shop/files/C6126P.jpg?v=1749660361',
  C6116PLM: 'https://p1rp.com/cdn/shop/files/C6116PLM.jpg?v=1749660362',
  C6126PLM: 'https://p1rp.com/cdn/shop/files/C6126PLM.jpg?v=1749660360',
  CDAL439: 'https://p1rp.com/cdn/shop/files/CDAL439_1.jpg?v=1749660328',
  CDS9439: 'https://p1rp.com/cdn/shop/files/CDS9439.jpg?v=1749660321',
  CDAL437: 'https://p1rp.com/cdn/shop/files/CDAL437.jpg?v=1749660329',
  CDAL443: 'https://p1rp.com/cdn/shop/files/CDAL443.jpg?v=1749660325',
  C6142P: 'https://p1rp.com/cdn/shop/files/C6142P.jpg?v=1749660359',
  C6146PLM: 'https://p1rp.com/cdn/shop/files/C6146PLM.jpg?v=1749660355',
  C6146P: 'https://p1rp.com/cdn/shop/files/C6146P.webp?v=1749660356',
  CDAL441: 'https://p1rp.com/cdn/shop/files/CDAL441.jpg?v=1749660327',
  CDAL442: 'https://p1rp.com/cdn/shop/files/CDAL442.jpg?v=1749660326',
  CDS9442: 'https://p1rp.com/cdn/shop/files/CDS9442.jpg?v=1749660319',
  C6145P: 'https://p1rp.com/cdn/shop/files/363-C6145P.webp?v=1749660358',
  C6145PLM: 'https://p1rp.com/cdn/shop/files/C6145PLM.jpg?v=1749660357',
  C6145SLM: 'https://p1rp.com/cdn/shop/files/C6145PLM_105c68c3-36e2-4a0e-8893-a88c1d6b4ff8.jpg?v=1749660356',
  C6147PLM: 'https://p1rp.com/cdn/shop/files/c6147plm.jpg?v=1749660353',
  C6147SLM: 'https://p1rp.com/cdn/shop/files/C6147SLM.jpg?v=1749660352',
  C6147P: 'https://p1rp.com/cdn/shop/files/C6147P.webp?v=1749660354',
  CDAL444: 'https://p1rp.com/cdn/shop/files/CDAL444.png?v=1749660324',
  C6149P: 'https://p1rp.com/cdn/shop/files/C6149P.webp?v=1749660351',
  CDAL447: 'https://p1rp.com/cdn/shop/files/CDAL447.webp?v=1749660323',
  CDS9447: 'https://p1rp.com/cdn/shop/files/CDAL447_bd093450-dd91-4c48-a93e-22a7fceda239.webp?v=1749660316',
  CDAL448: 'https://p1rp.com/cdn/shop/files/CDAL448.jpg?v=1749660322',
  CDS9448: 'https://p1rp.com/cdn/shop/files/CDAL448_bf09b32f-1850-477b-bc11-61de38ca946e.jpg?v=1749660315',
  C6149PLM: 'https://p1rp.com/cdn/shop/files/C6149PLM.webp?v=1749660350',
  C6149SLM: 'https://p1rp.com/cdn/shop/files/C6149PLM_b8c5549f-24bd-4561-a40d-b02ff394f885.webp?v=1749660349',
  C6151P: 'https://p1rp.com/cdn/shop/files/C6151P.webp?v=1749660348',
  C6151PLM: 'https://p1rp.com/cdn/shop/files/C6151PLM_830fda28-aff9-46dc-81c1-572fc9e588ee.webp?v=1749660347',
  C6151SLM: 'https://p1rp.com/cdn/shop/files/C6151PLM.webp?v=1749660347',

  // Duramax
  C6004PLM: 'https://p1rp.com/cdn/shop/files/C6004PLM_168d50d4-7f7f-4d9b-b058-b4693c2e0967.jpg?v=1749660377',
  C6004P: 'https://p1rp.com/cdn/shop/files/C6004P_94f21da7-0e45-49cb-ab48-096a2d8fb1cb.jpg?v=1749660378',
  C6020PLM: 'https://p1rp.com/cdn/shop/files/C6020PLM.jpg?v=1749660376',
  C6044PLM: 'https://p1rp.com/cdn/shop/files/C6044PLM.jpg?v=1749660374',
  C6044P: 'https://p1rp.com/cdn/shop/files/C6044P.jpg?v=1749660375',
  CGMAL426: 'https://p1rp.com/cdn/shop/files/CGMAL426.jpg?v=1749660302',
  CGMAL432: 'https://p1rp.com/cdn/shop/files/CGMAL432.jpg?v=1749660299',
  C6048PLM: 'https://p1rp.com/cdn/shop/files/C6048PLM.jpg?v=1749660370',
  C6048SLM: 'https://p1rp.com/cdn/shop/files/C6048SLM.jpg?v=1749660369',
  C6045PLM: 'https://p1rp.com/cdn/shop/files/C6045PLM.jpg?v=1749660372',
  C6045P: 'https://p1rp.com/cdn/shop/files/C6045P.jpg?v=1749660373',
  CGMAL429: 'https://p1rp.com/cdn/shop/files/CGMAL429.jpg?v=1749660301',
  CGMAL431: 'https://p1rp.com/cdn/shop/files/CGMAL431.jpg?v=1749660300',
  C6049PLM: 'https://p1rp.com/cdn/shop/files/C6049PLM.jpg?v=1749660367',
  C6049P: 'https://p1rp.com/cdn/shop/files/C6049P.jpg?v=1749660368',
  C6057P: 'https://p1rp.com/cdn/shop/files/C6057P.jpg?v=1749660363',
  CGMAL430: 'https://p1rp.com/cdn/shop/files/CGMAL430Render.png?v=1749660301',
  C6056P: 'https://p1rp.com/cdn/shop/files/C6056P.png?v=1749660366',
  CGMAL433: 'https://p1rp.com/cdn/shop/files/CGMAL433.jpg?v=1749660298',

  // Powerstroke
  C6254PLM: 'https://p1rp.com/cdn/shop/files/C6254PLM.jpg?v=1749660345',
  C6254SLM: 'https://p1rp.com/cdn/shop/files/C6254PLM_6a879d47-962c-408c-86aa-c1118f9b7092.jpg?v=1749660344',
  C6270P: 'https://p1rp.com/cdn/shop/files/C6270P.jpg?v=1749660337',
  CFAL457: 'https://p1rp.com/cdn/shop/files/CFAL457.jpg?v=1749660313',
  CFS9457: 'https://p1rp.com/cdn/shop/files/CFAL457_db06f687-23e5-4811-85ba-21d3b152e546.jpg?v=1749660305',
  CFAL464: 'https://p1rp.com/cdn/shop/files/CFAL464.jpg?v=1749660307',
  C6268PLM: 'https://p1rp.com/cdn/shop/files/C6268PLM.jpg?v=1749660339',
  C6268SLM: 'https://p1rp.com/cdn/shop/files/C6268PLM_e8e02772-d5ed-4b8e-8812-83df9a7ab259.jpg?v=1749660338',
  C6268P: 'https://p1rp.com/cdn/shop/files/C6268P.jpg?v=1749660340',
  C6241PLM: 'https://p1rp.com/cdn/shop/files/C6241PLM.jpg?v=1749660346',
  C6260PLM: 'https://p1rp.com/cdn/shop/files/C6260PLM.jpg?v=1749660343',
  C6260SLM: 'https://p1rp.com/cdn/shop/files/C6260SLM.jpg?v=1749660342',
  C6262P: 'https://p1rp.com/cdn/shop/files/C6262P.jpg?v=1749660341',
  CFAL458: 'https://p1rp.com/cdn/shop/files/CFAL458.jpg?v=1749660312',
  CFS9458: 'https://p1rp.com/cdn/shop/files/CFS9458.jpg?v=1749660304',
  CFAL462: 'https://p1rp.com/cdn/shop/files/CFAL462.jpg?v=1749660309',
  C6280PLM: 'https://p1rp.com/cdn/shop/files/C6280PLM.jpg?v=1749660336',
  C6280SLM: 'https://p1rp.com/cdn/shop/files/C6280SLM.jpg?v=1749660335',
  C6292SLM: 'https://p1rp.com/cdn/shop/files/C6292304.jpg?v=1749660332',
  C6292P: 'https://p1rp.com/cdn/shop/files/C6292P.webp?v=1749660334',
  C6292PLM: 'https://p1rp.com/cdn/shop/files/C6292PLM.webp?v=1749660333',
  CFAL461: 'https://p1rp.com/cdn/shop/files/CFAL461.jpg?v=1749660311',
  CFS9461: 'https://p1rp.com/cdn/shop/files/CFAL461_6b4a8a44-319a-45af-82f2-4bb1711a9a17.jpg?v=1749660303',
  CFAL463: 'https://p1rp.com/cdn/shop/files/CFAL463.jpg?v=1749660308',
  C6294PLM: 'https://p1rp.com/cdn/shop/files/C6294PLM.jpg?v=1749660330',
  C6294P: 'https://p1rp.com/cdn/shop/files/C6294P.jpg?v=1749660331',
  CFAL465: 'https://p1rp.com/cdn/shop/files/CFAL465.jpg?v=1749660306',
  C6293SLM: 'https://p1rp.com/cdn/shop/files/P1SX004Assembled_88dda462-ac4d-4afb-9cc5-976d68bba20f.png?v=1776716405',
  C6293PLM: 'https://p1rp.com/cdn/shop/files/P1SX004Assembled.png?v=1776716023',
  C6281SLM: 'https://p1rp.com/cdn/shop/files/Unknown-2.png?v=1783373310',
  C6281PLM: 'https://p1rp.com/cdn/shop/files/Unknown-2.png?v=1783373310',
  C6281P: 'https://p1rp.com/cdn/shop/files/Unknown-3.png?v=1783373626',
  CFAL466: 'https://p1rp.com/cdn/shop/files/Unknown-1.png?v=1776715105',
  CFALD20: 'https://p1rp.com/cdn/shop/files/CFALD20.png?v=1776715666',

  // Universal (Sprinter, EcoDiesel, Titan XD, Jeep Gladiator)
  C6301SLM: 'https://p1rp.com/cdn/shop/files/C6301.png?v=1776716914',
  C6301PLM: 'https://p1rp.com/cdn/shop/files/C6301.png?v=1776716914',
  CDAL446: 'https://p1rp.com/cdn/shop/files/CDAL446.png?v=1749660324',
  CDS9446: 'https://p1rp.com/cdn/shop/files/CDAL446_5a0af5de-fcd3-4cc3-939d-d54e17019abf.png?v=1749660318',
  CNAL401: 'https://p1rp.com/cdn/shop/files/CNAL401.jpg?v=1749660293',
  CJAL401: 'https://p1rp.com/cdn/shop/files/JeepGladiatorPic2.jpg?v=1749660295',
  CJS9401: 'https://p1rp.com/cdn/shop/files/JeepGladiatorPic2_a7f2d1c6-bee4-4a6e-b9ca-efcdb9fb1ec5.jpg?v=1749660294',

  // Exhaust tips (Armor Pro / Armor BLK)
  T5049: 'https://p1rp.com/cdn/shop/files/file_dc90f7fb-c8a3-4e87-975c-7666a17b5fa4.png?v=1784039260',
  T5050: 'https://p1rp.com/cdn/shop/files/file_c2ea426b-8c14-4760-b620-42f90e1b12c5.png?v=1784039263',
  T5051: 'https://p1rp.com/cdn/shop/files/file_06c83f09-e258-4af0-89c0-9d864c66f24c.png?v=1784039211',
  T5051BLK: 'https://p1rp.com/cdn/shop/files/file_24376ef3-af2b-4c5b-a5c5-c1393f007f69.png?v=1784039213',
  T5052: 'https://p1rp.com/cdn/shop/files/file_85c2191b-404a-4589-a00e-7dc5ee7da558.png?v=1784039239',
  T5053: 'https://p1rp.com/cdn/shop/files/file_f082f712-0a2e-4ad9-a59c-43da8f55b941.png?v=1784039221',
  T5053BLK: 'https://p1rp.com/cdn/shop/files/file_1d807956-4dce-4c05-9f9d-027aa9ccd6cb.png?v=1784039222',
  T5072: 'https://p1rp.com/cdn/shop/files/file_5957aad2-9566-4556-9731-a103bce3f84a.png?v=1784039234',
  T5072BLK: 'https://p1rp.com/cdn/shop/files/file_8ebbdaca-43a3-4a61-a53f-8f21de8f72db.png?v=1784039238',
  T5072CF: 'https://p1rp.com/cdn/shop/files/file_77e9076a-6ae4-441c-84ec-5a96307bd3e7.png?v=1784039281',
  T5073: 'https://p1rp.com/cdn/shop/files/file_68d60d87-cc17-4c5f-831b-d6e830be40c4.png?v=1784039218',
  T5074: 'https://p1rp.com/cdn/shop/files/file.png?v=1784039209',
  T5074BLK: 'https://p1rp.com/cdn/shop/files/file_0edd61d7-39bb-48ca-af33-a1fc62b36dde.png?v=1784039224',
  T5075: 'https://p1rp.com/cdn/shop/files/file_d0d5e49e-2ac1-425d-b584-7fd169a16481.png?v=1784039219',
  T5075BLK: 'https://p1rp.com/cdn/shop/files/file_bc5b027d-0d86-4f5d-91a0-61848d7a9f44.png?v=1784039227',
  T5075CF: 'https://p1rp.com/cdn/shop/files/file_f777ff65-eef1-4814-a602-b565aaf25c68.png?v=1784039282',
  T5081: 'https://p1rp.com/cdn/shop/files/file_25587faf-bfa9-403d-b918-a935524d4d32.png?v=1784039243',
  T5085: 'https://p1rp.com/cdn/shop/files/file_7aa039c1-707e-4a03-bebb-bda24aabeb8e.png?v=1784039236',
  T5086: 'https://p1rp.com/cdn/shop/files/file_ef5dc7a3-8a6f-4f8a-ade3-a58e553d8acd.png?v=1784039264',
  T5110: 'https://p1rp.com/cdn/shop/files/file_415b9bc1-d5e5-44cf-8747-986bc84ef4ea.png?v=1784039272',
  T5111BLK: 'https://p1rp.com/cdn/shop/files/file_f1128a61-5199-406d-a662-318d750a2d7c.png?v=1784039230',
  T5124: 'https://p1rp.com/cdn/shop/files/file_5c650610-0224-464a-b14c-654ec22777b1.png?v=1784039241',
  T5124BLK: 'https://p1rp.com/cdn/shop/files/file_5ff9b889-4c43-42fe-aa47-ca9b3512d00c.png?v=1784039255',
  T5125: 'https://p1rp.com/cdn/shop/files/file_1d3f1495-5ba0-4268-9858-235f0a93181a.png',
  T5125BLK: 'https://p1rp.com/cdn/shop/files/file_63338eae-8457-45f7-9b07-3f223e5bf792.png?v=1784039251',
  T5126: 'https://p1rp.com/cdn/shop/files/file_fd002dc0-d1db-4789-a584-41bfd7705b0d.png?v=1784039245',
  T5126BLK: 'https://p1rp.com/cdn/shop/files/file_44ba1bb5-4107-4ec2-b860-bdf2bfac3f49.png?v=1784039275',
  T5127: 'https://p1rp.com/cdn/shop/files/file_d9ae8fda-04e1-4242-9a6b-3f70630073dd.png?v=1784039232',
  T5127BLK: 'https://p1rp.com/cdn/shop/files/file_2f3a54a4-1893-487d-afe0-ff55aedef919.png?v=1784039249',
  T5128: 'https://p1rp.com/cdn/shop/files/file_c35997b4-044c-41b3-81ff-bbe366c98683.png?v=1784039252',
  T5128BLK: 'https://p1rp.com/cdn/shop/files/file_bcd96a0b-7f97-460e-b8b5-a272811018cb.png?v=1784039279',
  T5129: 'https://p1rp.com/cdn/shop/files/file_a7bf2810-e927-4de6-90f2-766ba084b000.png?v=1784039229',
  T5129BLK: 'https://p1rp.com/cdn/shop/files/file_d70e9480-7fe1-4e15-885f-bc376048d5cd.png?v=1784039270',
  T5130: 'https://p1rp.com/cdn/shop/files/file_a09e5a77-da7f-4ec3-8f17-08141265c78d.png?v=1784039253',
  T5130BLK: 'https://p1rp.com/cdn/shop/files/file_9c9ce840-5da3-4293-bfe5-9acc003112b6.png?v=1784039258',
  T5154: 'https://p1rp.com/cdn/shop/files/file_1f7d2478-508f-441e-999b-a0f1a4b50351.png?v=1784039215',
  T5154BLK: 'https://p1rp.com/cdn/shop/files/file_c53a3826-eeca-44c9-9a61-fa2ed52b8e61.png?v=1784039225',
  T5164BLK: 'https://p1rp.com/cdn/shop/files/file_50254ea1-8dc8-4308-b1fa-97efd72cc46a.png?v=1784039274',
  T5165BLK: 'https://p1rp.com/cdn/shop/files/file_5c328533-0560-4ebf-ba43-3d2299b02ec5.png?v=1784039261',
  T5166BLK: 'https://p1rp.com/cdn/shop/files/file_f6307fba-b66d-407e-b676-1a7b72cea1de.png?v=1784039277',
  T5167BLK: 'https://p1rp.com/cdn/shop/files/file_3145b18e-912e-46ee-8a52-d01145fd7d56.png?v=1784039266',
  T5169BLK: 'https://p1rp.com/cdn/shop/files/file_21c7e126-63c0-4440-b0be-66b11c52fd76.png?v=1784039268',
};

export function seedP1rpImages() {
  const update = db.prepare(`
    UPDATE products SET image_url = @image_url
    WHERE sku = @sku AND brand = 'P1RP' AND (image_url IS NULL OR image_url = '')
  `);
  let updated = 0;
  for (const [sku, image_url] of Object.entries(P1RP_IMAGE_MAP)) {
    try {
      const info = update.run({ sku, image_url });
      if (info.changes > 0) updated++;
    } catch (err) {
      console.error('[seedP1rpImages] update failed for', sku, '-', err.message);
    }
  }
  const total = Object.keys(P1RP_IMAGE_MAP).length;
  console.log(`[seedP1rpImages] set image_url on ${updated}/${total} P1RP rows this run (${P1RP_EXHAUST_PRODUCTS.length - total} P1RP products intentionally left without a confirmed photo).`);
}

export function seedFassProducts() {
  // Guard: this can run before the placeholder seed script has inserted
  // the 'fuel' category row (categories are seeded separately, and this
  // runs automatically whenever db.js loads). INSERT OR IGNORE here just
  // guarantees the foreign key target exists — if the seed script's own
  // (more complete) category row already exists, this is a no-op.
  db.prepare(`
    INSERT OR IGNORE INTO categories (slug, name, blurb, icon)
    VALUES ('fuel', 'Fuel Systems', 'Lift pumps, injectors, and fuel delivery upgrades', 'fuel')
  `).run();

  const insert = db.prepare(`
    INSERT OR IGNORE INTO products
      (id, sku, name, brand, category_slug, platform_slug, price_cents, description, weight_lbs, supplier, active, stock_qty)
    VALUES
      (@id, @sku, @name, 'FASS', 'fuel', @platformSlug, @priceCents, @description, 26, 'FASS Fuel Systems (authorized dealer, MAP pricing)', 1, 3)
  `);
  for (const p of [...FASS_STANDARD_PRODUCTS, ...FASS_PLUS_NODROP_PRODUCTS]) insert.run(p);

  // Name is NOT in the admin-editable field list, so INSERT OR IGNORE
  // above never touches it on rows that already exist. That's exactly
  // what we want for admin-made edits to price/stock/active/etc — but it
  // also means a wording fix to the `name` field in the arrays above
  // (e.g. adding the vehicle/engine fitment to the title) never reaches
  // already-seeded rows on its own. This UPDATE keeps FASS product
  // titles in sync with the source data above on every boot, while still
  // leaving every other admin-editable field alone.
  const updateName = db.prepare(`UPDATE products SET name = @name WHERE id = @id AND brand = 'FASS'`);
  for (const p of [...FASS_STANDARD_PRODUCTS, ...FASS_PLUS_NODROP_PRODUCTS]) {
    updateName.run({ id: p.id, name: p.name });
  }
}

// ============================================================
// No Limit Fabrication — proprietary/in-house products only.
// No Limit's site also resells third-party brands (BD Diesel,
// H&S Motorsports, Fleece Performance, Exergy, Kryptonite, Axiom
// Supply, ICON, Garrett, etc.) across all three platform pages —
// those are intentionally excluded here per Cody's direction to add
// only what's actually manufactured by No Limit themselves.
// Compiled from nolimitfabrication.com's own category pages
// (turbo kits, cold air intakes, intercooler & piping, engine &
// accessories, suspension). Their proprietary lineup turned out to
// be almost entirely Ford Power Stroke — only one Duramax item
// (a drop-in LLY-LMM turbo) and nothing proprietary for Cummins;
// Cummins/Duramax platform pages on their site are 100% resold
// third-party brands. A couple of universal-fit accessories
// (silicone couplers, catch can parts) use platformSlug 'universal'
// like the DCC turbo batch above. Prices are No Limit's own listed
// USD retail pricing (not yet converted/marked up for CAD — same
// caveat as noted elsewhere pending a markup pass). weight_lbs left
// NULL (not collected this pass) — checkout.js falls back to a
// per-category shipping estimate until real weights are entered.
// image_url intentionally left unset here — product photos are a
// separate follow-up pass (same two-step approach as P1RP: products
// first, then a dedicated image-matching batch), since No Limit's
// site images need the same per-product sourcing check P1RP got
// rather than being bulk-pulled from category grid thumbnails.
// Same INSERT OR IGNORE safety as every other batch above: only
// adds missing rows, never overwrites a price/stock/active edit
// made in Admin -> Products on a later deploy.
// ============================================================
const NO_LIMIT_TURBO_PRODUCTS = [
  { id: 'nolimit-whistler-1519', sku: 'NLWVGT1519', name: '2015-2019 6.7 Powerstroke Whistler VGT Drop-In Turbo', platformSlug: 'powerstroke', priceCents: 284900, description: 'No Limit Fabrication Whistler VGT drop-in turbocharger for 2015-2019 6.7L Ford Power Stroke. Direct bolt-in replacement for the factory variable geometry turbo.' },
  { id: 'nolimit-whistler-1114', sku: 'NLWVGT1114', name: '2011-2014 6.7 Powerstroke Whistler VGT Drop-In Turbo', platformSlug: 'powerstroke', priceCents: 274900, description: 'No Limit Fabrication Whistler VGT drop-in turbocharger for 2011-2014 6.7L Ford Power Stroke. Direct bolt-in replacement for the factory variable geometry turbo.' },
  { id: 'nolimit-67-compound', sku: 'NLCOMP6726', name: '2011-2026 6.7 Powerstroke Compound Turbo Kit', platformSlug: 'powerstroke', priceCents: 339900, description: 'No Limit Fabrication compound turbo kit for 2011-2026 6.7L Ford Power Stroke, adding an atmosphere-stage turbo ahead of the charge-air turbo for increased airflow.' },
  { id: 'nolimit-whistler-0307', sku: 'NLWVGT0307', name: '2003-2007 6.0 Powerstroke Whistler VGT Drop-In Turbo', platformSlug: 'powerstroke', priceCents: 154900, description: 'No Limit Fabrication Whistler VGT drop-in turbocharger for 2003-2007 6.0L Ford Power Stroke. Direct bolt-in replacement for the factory variable geometry turbo.' },
  { id: 'nolimit-retrofit-1114', sku: 'NLRETRO1114', name: '2011-2014 6.7 Powerstroke Retrofit Kit for 2015+ Style Turbo', platformSlug: 'powerstroke', priceCents: 144900, description: 'No Limit Fabrication retrofit kit that allows a 2015+ style 6.7L Power Stroke turbo to be installed on 2011-2014 trucks.' },
  { id: 'nolimit-duramax-llylmm-turbo', sku: 'NLDMAXLLYLMM', name: 'Drop-In Factory Replacement Turbo — LLY-LMM 6.6L Duramax', platformSlug: 'duramax', priceCents: 209900, description: 'No Limit Fabrication drop-in factory replacement turbocharger for LLY through LMM generation 6.6L GM Duramax engines.' },
  { id: 'nolimit-turbo-blanket', sku: 'NLTBLANKET', name: 'No Limit Fabrication Turbo Blanket', platformSlug: 'universal', priceCents: 12900, description: 'Heat-resistant turbo blanket to reduce underhood temperatures and improve exhaust gas velocity. Universal fit.' },
  { id: 'nolimit-67-ballbearing', sku: 'NLBB67PS', name: '6.7 Powerstroke Drop-In Precision Ball Bearing Turbo Kit', platformSlug: 'powerstroke', priceCents: 449900, description: 'No Limit Fabrication drop-in precision ball bearing turbo kit for 6.7L Ford Power Stroke, for quicker spool response versus the factory journal-bearing unit.' },
];

const NO_LIMIT_INTAKE_PRODUCTS = [
  { id: 'nolimit-intake-2026', sku: 'NLCAI2026', name: '2020-2026 6.7 Powerstroke Cold Air Intake', platformSlug: 'powerstroke', priceCents: 34900, description: 'No Limit Fabrication cold air intake for 2020-2026 6.7L Ford Power Stroke.' },
  { id: 'nolimit-intake-1719-s2', sku: 'NLCAI1719S2', name: '2017-2019 6.7 Powerstroke Cold Air Intake Stage 2', platformSlug: 'powerstroke', priceCents: 34900, description: 'No Limit Fabrication Stage 2 cold air intake for 2017-2019 6.7L Ford Power Stroke.' },
  { id: 'nolimit-intake-1116-s2', sku: 'NLCAI1116S2', name: '2011-2016 6.7 Powerstroke Cold Air Intake Stage 2', platformSlug: 'powerstroke', priceCents: 34900, description: 'No Limit Fabrication Stage 2 cold air intake for 2011-2016 6.7L Ford Power Stroke.' },
  { id: 'nolimit-intake-1116-s1', sku: 'NLCAI1116S1', name: '2011-2016 6.7 Powerstroke Cold Air Intake Stage 1', platformSlug: 'powerstroke', priceCents: 32900, description: 'No Limit Fabrication Stage 1 cold air intake for 2011-2016 6.7L Ford Power Stroke.' },
  { id: 'nolimit-intake-1719-s1', sku: 'NLCAI1719S1', name: '2017-2019 6.7 Powerstroke Cold Air Intake Stage 1', platformSlug: 'powerstroke', priceCents: 34900, description: 'No Limit Fabrication Stage 1 cold air intake for 2017-2019 6.7L Ford Power Stroke.' },
  { id: 'nolimit-intake-0810', sku: 'NLCAI0810', name: '2008-2010 6.4 Powerstroke Cold Air Intake', platformSlug: 'powerstroke', priceCents: 34900, description: 'No Limit Fabrication cold air intake for 2008-2010 6.4L Ford Power Stroke.' },
  { id: 'nolimit-intake-60', sku: 'NLCAI60', name: '6.0 Powerstroke Cold Air Intake', platformSlug: 'powerstroke', priceCents: 37900, description: 'No Limit Fabrication cold air intake for 6.0L Ford Power Stroke.' },
  { id: 'nolimit-intake-closedbox-1719', sku: 'NLCAICB1719', name: '2017-2019 Ford Powerstroke Premium Closed Box Intake', platformSlug: 'powerstroke', priceCents: 49900, description: 'No Limit Fabrication premium closed-box cold air intake for 2017-2019 Ford Power Stroke.' },
  { id: 'nolimit-intake-premium-1116', sku: 'NLCAIPREM1116', name: '2011-2016 6.7 Powerstroke Premium Cold Air Intake', platformSlug: 'powerstroke', priceCents: 49900, description: 'No Limit Fabrication premium cold air intake for 2011-2016 6.7L Ford Power Stroke.' },
  { id: 'nolimit-intake-30', sku: 'NLCAI30', name: '3.0 Powerstroke Cold Air Intake', platformSlug: 'powerstroke', priceCents: 37905, description: 'No Limit Fabrication cold air intake for the 3.0L Ford Power Stroke.' },
  { id: 'nolimit-custom-filter', sku: 'NLCAIFILTER', name: 'No Limit Fabrication Custom Air Filter', platformSlug: 'universal', priceCents: 9500, description: 'Replacement custom air filter sized for No Limit Fabrication cold air intake systems.' },
  { id: 'nolimit-prefilter', sku: 'NLPREFILTER', name: 'No Limit Fabrication Pre Filter', platformSlug: 'universal', priceCents: 4999, description: 'Pre-filter sock to extend service life of a No Limit Fabrication cold air intake filter in dusty conditions.' },
];

const NO_LIMIT_COOLING_PRODUCTS = [
  { id: 'nolimit-boost-bundle-67', sku: 'NLBB67', name: '6.7 Powerstroke Boost Bundle Kit', platformSlug: 'powerstroke', priceCents: 48840, description: 'No Limit Fabrication boost bundle kit for 6.7L Ford Power Stroke, bundling hot side and cold side piping upgrades.' },
  { id: 'nolimit-hf-bundle-67', sku: 'NLHFB67', name: '6.7 Powerstroke High Flow Bundle Kit', platformSlug: 'powerstroke', priceCents: 77900, description: 'No Limit Fabrication high flow intercooler piping bundle kit for 6.7L Ford Power Stroke.' },
  { id: 'nolimit-hf-bundle-64', sku: 'NLHFB64', name: '6.4 Powerstroke High Flow Bundle Kit', platformSlug: 'powerstroke', priceCents: 98910, description: 'No Limit Fabrication high flow intercooler piping bundle kit for 6.4L Ford Power Stroke.' },
  { id: 'nolimit-hf-bundle-60', sku: 'NLHFB60', name: '6.0 Powerstroke High Flow Bundle Kit', platformSlug: 'powerstroke', priceCents: 92610, description: 'No Limit Fabrication high flow intercooler piping bundle kit for 6.0L Ford Power Stroke.' },
  { id: 'nolimit-ic-piping-67', sku: 'NLICPIPE67', name: '6.7 Powerstroke Intercooler Piping Kit', platformSlug: 'powerstroke', priceCents: 149900, description: 'No Limit Fabrication full intercooler piping kit for 6.7L Ford Power Stroke.' },
  { id: 'nolimit-a2w-stage2-67', sku: 'NLA2WS267', name: '6.7 Powerstroke Stage 2 Performance Air To Water Intercooler', platformSlug: 'powerstroke', priceCents: 124900, description: 'No Limit Fabrication Stage 2 performance air-to-water intercooler for 6.7L Ford Power Stroke.' },
  { id: 'nolimit-a2w-stage1-67', sku: 'NLA2WS167', name: '6.7 Powerstroke Stage 1 Factory Replacement Air To Water Intercooler', platformSlug: 'powerstroke', priceCents: 69900, description: 'No Limit Fabrication Stage 1 factory-replacement air-to-water intercooler for 6.7L Ford Power Stroke.' },
  { id: 'nolimit-hotside-67', sku: 'NLHSPIPE67', name: '2011-2026 6.7 Powerstroke Hot Side Pipe Kit', platformSlug: 'powerstroke', priceCents: 23900, description: 'No Limit Fabrication hot side intercooler pipe kit for 2011-2026 6.7L Ford Power Stroke.' },
  { id: 'nolimit-coldside-67', sku: 'NLCSPIPE67', name: '2011+ 6.7 Powerstroke Cold Side Intercooler Pipe Kit', platformSlug: 'powerstroke', priceCents: 28900, description: 'No Limit Fabrication cold side intercooler pipe kit for 2011+ 6.7L Ford Power Stroke.' },
  { id: 'nolimit-coldside-60', sku: 'NLCSKIT60', name: '6.0 Powerstroke Coldside Kit', platformSlug: 'powerstroke', priceCents: 35000, description: 'No Limit Fabrication cold side intercooler piping kit for 6.0L Ford Power Stroke.' },
  { id: 'nolimit-hotside-60', sku: 'NLHSPIPE60', name: '6.0 Powerstroke Hotside Pipe', platformSlug: 'powerstroke', priceCents: 30000, description: 'No Limit Fabrication hot side intercooler pipe for 6.0L Ford Power Stroke.' },
  { id: 'nolimit-hotpipe-64', sku: 'NLHOTPIPE64', name: '6.4 Powerstroke Hot Pipe', platformSlug: 'powerstroke', priceCents: 40000, description: 'No Limit Fabrication hot side intercooler pipe for 6.4L Ford Power Stroke.' },
  { id: 'nolimit-coldside-64', sku: 'NLCSKIT64', name: '2008-2010 6.4 Powerstroke Coldside Kit', platformSlug: 'powerstroke', priceCents: 40000, description: 'No Limit Fabrication cold side intercooler piping kit for 2008-2010 6.4L Ford Power Stroke.' },
  { id: 'nolimit-downpipe-1114', sku: 'NLDP1114', name: '2011-2014 6.7 Powerstroke 4" Stainless Steel Downpipe', platformSlug: 'powerstroke', priceCents: 24900, description: 'No Limit Fabrication 4-inch stainless steel downpipe for 2011-2014 6.7L Ford Power Stroke.' },
  { id: 'nolimit-downpipe-1519', sku: 'NLDP1519', name: '2015-2019 6.7 Powerstroke 4" Stainless Steel Downpipe', platformSlug: 'powerstroke', priceCents: 24900, description: 'No Limit Fabrication 4-inch stainless steel downpipe for 2015-2019 6.7L Ford Power Stroke.' },
  { id: 'nolimit-downpipe-2022', sku: 'NLDP2022', name: '2020-2022 6.7 Powerstroke 4" Stainless Steel Downpipe', platformSlug: 'powerstroke', priceCents: 24900, description: 'No Limit Fabrication 4-inch stainless steel downpipe for 2020-2022 6.7L Ford Power Stroke.' },
  { id: 'nolimit-icbootset-60', sku: 'NLICBOOT60', name: '6.0 Powerstroke Complete Intercooler Boot Set', platformSlug: 'powerstroke', priceCents: 14900, description: 'No Limit Fabrication complete intercooler boot set for 6.0L Ford Power Stroke.' },
  { id: 'nolimit-icbootset-64', sku: 'NLICBOOT64', name: '6.4 Powerstroke Complete Intercooler Boot Set', platformSlug: 'powerstroke', priceCents: 14900, description: 'No Limit Fabrication complete intercooler boot set for 6.4L Ford Power Stroke.' },
  { id: 'nolimit-a2a-60', sku: 'NLA2A60', name: '6.0 Powerstroke Air To Air Intercooler', platformSlug: 'powerstroke', priceCents: 134900, description: 'No Limit Fabrication air-to-air intercooler for 6.0L Ford Power Stroke.' },
  { id: 'nolimit-a2a-64', sku: 'NLA2A64', name: '6.4 Powerstroke Air To Air Intercooler', platformSlug: 'powerstroke', priceCents: 134900, description: 'No Limit Fabrication air-to-air intercooler for 6.4L Ford Power Stroke.' },
  { id: 'nolimit-a2a-73', sku: 'NLA2A73', name: '1999-2003 7.3 Powerstroke Air To Air Intercooler', platformSlug: 'powerstroke', priceCents: 134900, description: 'No Limit Fabrication air-to-air intercooler for 1999-2003 7.3L Ford Power Stroke.' },
  { id: 'nolimit-lower-ic-hose', sku: 'NLLOWERICHOSE', name: '6.0/6.4 Powerstroke Lower Intercooler Hose', platformSlug: 'powerstroke', priceCents: 4900, description: 'No Limit Fabrication lower intercooler hose for 6.0L/6.4L Ford Power Stroke.' },
  { id: 'nolimit-sil-hose-2x3', sku: 'NLSILHOSE23', name: '2" ID x 3" Long Silicone Hose', platformSlug: 'universal', priceCents: 2900, description: 'Universal 2-inch ID x 3-inch long silicone coupler hose.' },
  { id: 'nolimit-sil-elbow-390', sku: 'NLSILELBOW390', name: '3" ID 90° Silicone Elbow', platformSlug: 'universal', priceCents: 3900, description: 'Universal 3-inch ID 90-degree silicone elbow.' },
  { id: 'nolimit-sil-red-335', sku: 'NLSILRED335', name: '3" ID To 3.5" ID x 6" Long Silicone Reducer', platformSlug: 'universal', priceCents: 4900, description: 'Universal 3-inch to 3.5-inch ID x 6-inch long silicone reducer coupler.' },
  { id: 'nolimit-sil-coupler-3x4', sku: 'NLSILCPL34', name: '3" ID x 4" Long 6-Ply Silicone Coupler', platformSlug: 'universal', priceCents: 2900, description: 'Universal 3-inch ID x 4-inch long 6-ply silicone coupler.' },
  { id: 'nolimit-sil-coupler-3x6', sku: 'NLSILCPL36', name: '3" ID x 6" Long 2-Hump Silicone Coupler with SS Rings', platformSlug: 'universal', priceCents: 4900, description: 'Universal 3-inch ID x 6-inch long 2-hump silicone coupler with stainless steel support rings.' },
  { id: 'nolimit-sil-coupler-3258', sku: 'NLSILCPL3258', name: '3" To 2-5/8" 90° Silicone Coupler', platformSlug: 'universal', priceCents: 3900, description: 'Universal 3-inch to 2-5/8-inch 90-degree silicone coupler.' },
  { id: 'nolimit-hotside-boot-60', sku: 'NLHSBOOT60', name: '6.0 Powerstroke Hot Side Turbo Connection Boot', platformSlug: 'powerstroke', priceCents: 3900, description: 'No Limit Fabrication hot side turbo connection boot for 6.0L Ford Power Stroke.' },
];

const NO_LIMIT_ENGINE_PRODUCTS = [
  { id: 'nolimit-turbo-circ-line-23', sku: 'NLTCIRC23', name: '2023+ 6.7 Powerstroke High Output Turbo Circulation Line Kit', platformSlug: 'powerstroke', priceCents: 14900, description: 'No Limit Fabrication turbo circulation line kit for 2023+ high output 6.7L Ford Power Stroke.' },
  { id: 'nolimit-coolant-line-1126', sku: 'NLCOOLLINE1126', name: '2011-2026 6.7 Powerstroke Coolant Line Kit', platformSlug: 'powerstroke', priceCents: 15900, description: 'No Limit Fabrication coolant line kit for 2011-2026 6.7L Ford Power Stroke.' },
  { id: 'nolimit-6r140-pan', sku: 'NL6R140PAN', name: 'No Limit Fabrication Billet 6R140 Transmission Pan', platformSlug: 'powerstroke', priceCents: 69900, description: 'Billet aluminum 6R140 transmission pan for added fluid capacity and cooling on Ford Power Stroke trucks.' },
  { id: 'nolimit-oilpan-67', sku: 'NLOILPAN67', name: '2011-2026 6.7 Powerstroke High Capacity Billet Oil Pan', platformSlug: 'powerstroke', priceCents: 59900, description: 'No Limit Fabrication high capacity billet oil pan for 2011-2026 6.7L Ford Power Stroke.' },
  { id: 'nolimit-catch-can', sku: 'NLCATCHCAN', name: 'No Limit Fabrication Catch Can', platformSlug: 'universal', priceCents: 29900, description: 'Billet oil catch can to trap crankcase oil vapor before it reaches the intake system. Universal mount.' },
  { id: 'nolimit-venturi', sku: 'NLVENTURI', name: 'No Limit Fabrication Universal Venturi', platformSlug: 'universal', priceCents: 12900, description: 'Universal venturi fitting for catch can and crankcase ventilation setups.' },
  { id: 'nolimit-diffcover-14bolt', sku: 'NLDIFF14BOLT', name: 'Ford SuperDuty Billet Differential Cover — 14 Bolt', platformSlug: 'powerstroke', priceCents: 59900, description: 'No Limit Fabrication billet rear differential cover for Ford Super Duty 14-bolt axles.' },
  { id: 'nolimit-sec-coolant-tank-67', sku: 'NLSECTANK67', name: '2011-2026 6.7 Powerstroke Secondary Coolant Tank', platformSlug: 'powerstroke', priceCents: 44900, description: 'No Limit Fabrication secondary coolant tank for 2011-2026 6.7L Ford Power Stroke.' },
  { id: 'nolimit-cp4-bypass', sku: 'NLCP4BYPASS', name: '2011-2024 6.7 Powerstroke CP4 Disaster Prevention Bypass Kit', platformSlug: 'powerstroke', priceCents: 32900, description: 'No Limit Fabrication CP4 fuel pump failure bypass kit for 2011-2024 6.7L Ford Power Stroke, intended to help protect the fuel system if the CP4 pump fails.' },
  { id: 'nolimit-primary-coolant-tank-67', sku: 'NLPRIMTANK67', name: '2011-2026 6.7 Powerstroke Aluminum Primary Coolant Tank', platformSlug: 'powerstroke', priceCents: 64900, description: 'No Limit Fabrication aluminum primary coolant tank for 2011-2026 6.7L Ford Power Stroke.' },
  { id: 'nolimit-uppercoolant-1126', sku: 'NLUPCOOL1126', name: '2011-Current 6.7 Powerstroke Upper Coolant Hose Upgrade Kit', platformSlug: 'powerstroke', priceCents: 44900, description: 'No Limit Fabrication upper coolant hose upgrade kit for 2011-current 6.7L Ford Power Stroke.' },
  { id: 'nolimit-uppercoolant-60', sku: 'NLUPCOOL60', name: '6.0 Powerstroke Upper Coolant Hose Upgrade Kit', platformSlug: 'powerstroke', priceCents: 24900, description: 'No Limit Fabrication upper coolant hose upgrade kit for 6.0L Ford Power Stroke.' },
  { id: 'nolimit-uppipe-64', sku: 'NLUPPIPE64HD', name: '6.4 Powerstroke HD Up-Pipe Kit', platformSlug: 'powerstroke', priceCents: 39900, description: 'No Limit Fabrication heavy-duty up-pipe kit for 6.4L Ford Power Stroke.' },
  { id: 'nolimit-coolanttank-64', sku: 'NLCOOLTANK64', name: '6.4 Powerstroke Aluminum Coolant Tank', platformSlug: 'powerstroke', priceCents: 64900, description: 'No Limit Fabrication aluminum coolant tank for 6.4L Ford Power Stroke.' },
  { id: 'nolimit-pass-coolant-fix-64', sku: 'NLPASSCOOL64', name: '6.4 Powerstroke Passenger Coolant Line Fix', platformSlug: 'powerstroke', priceCents: 14900, description: 'No Limit Fabrication passenger side coolant line fix kit for 6.4L Ford Power Stroke.' },
  { id: 'nolimit-oilcooler-reloc-67', sku: 'NLOILCOOLRELOC67', name: '6.7 Powerstroke Oil Cooler Relocation Kit', platformSlug: 'powerstroke', priceCents: 99900, description: 'No Limit Fabrication oil cooler relocation kit for 6.7L Ford Power Stroke.' },
  { id: 'nolimit-battreloc-1719', sku: 'NLBATRELOC1719', name: '2017-2019 6.7 Powerstroke Passenger Side Battery Relocation Kit', platformSlug: 'powerstroke', priceCents: 29900, description: 'No Limit Fabrication passenger side battery relocation kit for 2017-2019 6.7L Ford Power Stroke.' },
  { id: 'nolimit-capset-67', sku: 'NLCAPSET67', name: '6.7 Powerstroke Cap Set', platformSlug: 'powerstroke', priceCents: 22900, description: 'No Limit Fabrication coolant/oil cap set for 6.7L Ford Power Stroke.' },
  { id: 'nolimit-turbohoseboot-67', sku: 'NLTURBOBOOT67', name: '6.7 Powerstroke Turbo Hose Boot', platformSlug: 'powerstroke', priceCents: 7900, description: 'No Limit Fabrication turbo hose boot for 6.7L Ford Power Stroke.' },
  { id: 'nolimit-batteryholddowns', sku: 'NLBATHOLDDOWN', name: 'No Limit Fabrication Battery Hold Downs', platformSlug: 'universal', priceCents: 22900, description: 'Billet battery hold-down set. Universal fit.' },
  { id: 'nolimit-hotside-boot-kit-1126', sku: 'NLHSBOOTKIT1126', name: '2011-2026 6.7 Powerstroke Complete Hot Side Boot Kit', platformSlug: 'powerstroke', priceCents: 12900, description: 'No Limit Fabrication complete hot side boot kit for 2011-2026 6.7L Ford Power Stroke.' },
  { id: 'nolimit-deftankplate', sku: 'NLDEFPLATE', name: 'No Limit Fabrication DEF Tank Plate', platformSlug: 'powerstroke', priceCents: 7900, description: 'No Limit Fabrication DEF tank skid plate for Ford Power Stroke trucks.' },
  { id: 'nolimit-10r140-pan', sku: 'NL10R140PAN', name: '2020-Current 6.7 Powerstroke Billet 10R140 Transmission Pan', platformSlug: 'powerstroke', priceCents: 99900, description: 'No Limit Fabrication billet 10R140 transmission pan for 2020-current 6.7L Ford Power Stroke.' },
  { id: 'nolimit-diffcover-12bolt-9916', sku: 'NLDIFF12BOLT9916', name: 'Ford SuperDuty Billet Differential Cover — 12 Bolt (1999-2016)', platformSlug: 'powerstroke', priceCents: 59900, description: 'No Limit Fabrication billet rear differential cover for 1999-2016 Ford Super Duty 12-bolt axles.' },
  { id: 'nolimit-diffcover-12bolt-99cur', sku: 'NLDIFF12BOLT99CUR', name: 'Ford SuperDuty Billet Differential Cover — 12 Bolt (1999-Current)', platformSlug: 'powerstroke', priceCents: 59900, description: 'No Limit Fabrication billet rear differential cover for 1999-current Ford Super Duty 12-bolt axles.' },
  { id: 'nolimit-reservoircap-67', sku: 'NLRESCAP67', name: 'High Performance 6.7 Powerstroke Secondary Reservoir Cap', platformSlug: 'powerstroke', priceCents: 3999, description: 'No Limit Fabrication high performance secondary coolant reservoir cap for 6.7L Ford Power Stroke.' },
  { id: 'nolimit-rotaryswitch-1122', sku: 'NLROTARYSW1122', name: '2011-2022 Rotary Switch Bracket', platformSlug: 'powerstroke', priceCents: 3999, description: 'No Limit Fabrication rotary switch mounting bracket for 2011-2022 Ford Power Stroke trucks.' },
  { id: 'nolimit-fuelsump', sku: 'NLFUELSUMP', name: 'No Limit Fabrication Universal Fuel Sump', platformSlug: 'universal', priceCents: 18900, description: 'Universal fuel sump kit for auxiliary lift pump plumbing.' },
  { id: 'nolimit-sec-coolant-line-1114', sku: 'NLSECLINE1114', name: '2011-2014 6.7 Powerstroke Secondary Coolant Line', platformSlug: 'powerstroke', priceCents: 7900, description: 'No Limit Fabrication secondary coolant line for 2011-2014 6.7L Ford Power Stroke.' },
  { id: 'nolimit-molded-hose-67', sku: 'NLMOLDEDHOSE67', name: '6.7 Powerstroke Molded Hose', platformSlug: 'powerstroke', priceCents: 7900, description: 'No Limit Fabrication molded coolant hose for 6.7L Ford Power Stroke.' },
];

const NO_LIMIT_SUSPENSION_PRODUCTS = [
  { id: 'nolimit-reverse-level-kit', sku: 'NLREVLEVEL', name: 'No Limit Fabrication Ford Super Duty Reverse Level Kit', platformSlug: 'powerstroke', priceCents: 249900, description: 'No Limit Fabrication reverse leveling kit for Ford Super Duty, restoring factory rake after a front leveling kit.' },
  { id: 'nolimit-traction-bars', sku: 'NLTRACBARS', name: 'No Limit Fabrication Premium Traction Bars', platformSlug: 'powerstroke', priceCents: 109900, description: 'No Limit Fabrication premium traction bars for Ford Super Duty, reducing axle wrap under hard acceleration.' },
  { id: 'nolimit-bodymounts-0816', sku: 'NLBODYMT0816', name: 'No Limit Fabrication Body Mounts — 2008-2016 Ford Super Duty', platformSlug: 'powerstroke', priceCents: 39900, description: 'No Limit Fabrication replacement body mount set for 2008-2016 Ford Super Duty.' },
  { id: 'nolimit-bodymounts-0307', sku: 'NLBODYMT0307', name: 'No Limit Fabrication Body Mounts — 2003-2007 Ford Super Duty', platformSlug: 'powerstroke', priceCents: 44900, description: 'No Limit Fabrication replacement body mount set for 2003-2007 Ford Super Duty.' },
  { id: 'nolimit-radsupport-17', sku: 'NLRADSUPPORT17', name: 'No Limit Fabrication Silicone Radiator Support Mounts — 2017+', platformSlug: 'powerstroke', priceCents: 14900, description: 'No Limit Fabrication silicone radiator support mounts for 2017+ Ford Super Duty.' },
  { id: 'nolimit-bodymounts-9903', sku: 'NLBODYMT9903', name: 'No Limit Fabrication Body Mounts — 1999-2003 Ford Super Duty', platformSlug: 'powerstroke', priceCents: 44900, description: 'No Limit Fabrication replacement body mount set for 1999-2003 Ford Super Duty.' },
  { id: 'nolimit-bumpstop', sku: 'NLBUMPSTOP', name: 'No Limit Fabrication Front Bump Stop', platformSlug: 'powerstroke', priceCents: 14900, description: 'No Limit Fabrication front bump stop for Ford Super Duty suspension systems.' },
];

export function seedNoLimitProducts() {
  // Guard every category this batch touches, not just the two brand-new
  // ones ('cooling', 'engine') — 'intake' and 'turbochargers' and
  // 'suspension' are normally seeded by seed.js before db.js's seed
  // functions run (see server.js's start command), but nothing here
  // should assume that ordering. INSERT OR IGNORE is a no-op wherever
  // seed.js's own (more complete) row already exists.
  const ensureCategory = db.prepare(`INSERT OR IGNORE INTO categories (slug, name, blurb, icon) VALUES (@slug, @name, @blurb, @icon)`);
  ensureCategory.run({ slug: 'cooling', name: 'Intercoolers & Piping', blurb: 'Intercoolers, hot/cold side piping, and coolant hardware', icon: 'intercooler' });
  ensureCategory.run({ slug: 'engine', name: 'Engine Hardware', blurb: 'Coolant tanks, transmission pans, and engine bay accessories', icon: 'engine' });
  ensureCategory.run({ slug: 'intake', name: 'Intake Systems', blurb: 'Cold air intakes & filters', icon: 'intake' });
  ensureCategory.run({ slug: 'turbochargers', name: 'Turbochargers', blurb: 'Drop-in & compound turbo kits', icon: 'turbo' });
  ensureCategory.run({ slug: 'suspension', name: 'Suspension & Lift', blurb: 'Lift kits, leveling kits & shocks', icon: 'lift' });

  const batches = [
    { products: NO_LIMIT_TURBO_PRODUCTS, categorySlug: 'turbochargers' },
    { products: NO_LIMIT_INTAKE_PRODUCTS, categorySlug: 'intake' },
    { products: NO_LIMIT_COOLING_PRODUCTS, categorySlug: 'cooling' },
    { products: NO_LIMIT_ENGINE_PRODUCTS, categorySlug: 'engine' },
    { products: NO_LIMIT_SUSPENSION_PRODUCTS, categorySlug: 'suspension' },
  ];

  const insert = db.prepare(`
    INSERT OR IGNORE INTO products
      (id, sku, name, brand, category_slug, platform_slug, price_cents, description, weight_lbs, supplier, active, stock_qty)
    VALUES
      (@id, @sku, @name, 'No Limit Fabrication', @categorySlug, @platformSlug, @priceCents, @description, NULL, 'No Limit Fabrication', 1, 3)
  `);
  const updateName = db.prepare(`UPDATE products SET name = @name WHERE id = @id AND brand = 'No Limit Fabrication'`);

  let inserted = 0;
  let total = 0;
  for (const { products, categorySlug } of batches) {
    total += products.length;
    for (const p of products) {
      try {
        const info = insert.run({ ...p, categorySlug });
        if (info.changes > 0) inserted++;
      } catch (err) {
        console.error('[seedNoLimitProducts] insert failed for', p.id, '-', err.message);
      }
      try {
        updateName.run({ id: p.id, name: p.name });
      } catch (err) {
        console.error('[seedNoLimitProducts] update failed for', p.id, '-', err.message);
      }
    }
  }

  const nlCount = db.prepare(`SELECT COUNT(*) AS c FROM products WHERE brand = 'No Limit Fabrication'`).get().c;
  console.log(`[seedNoLimitProducts] inserted ${inserted}/${total} new rows this run; ${nlCount} No Limit Fabrication rows total in DB now.`);
}

// South Bend Clutch
// Pricing/part data sourced from Dirty Diesel Customs (dirtydieselcustom.ca), a
// Canadian South Bend Clutch dealer — prices are already in CAD, no conversion
// needed. Every SKU is real South Bend Clutch inventory (clutch kits, master
// cylinders, flywheels, throw-out bearings, starter spacers) for Cummins,
// Powerstroke, and Duramax platforms. A handful of older pre-Powerstroke IDI
// Ford and pre-Duramax GM 6.5L items were excluded since they don't fit the
// cummins/powerstroke/duramax platform scope.
// image_url intentionally left unset for all rows — same two-step approach as
// P1RP/No Limit: photos need their own per-SKU sourcing pass rather than being
// bulk-pulled from a reseller's site.
const SOUTH_BEND_PRODUCTS = [
  { id: 'southbend-hydx-750', sku: 'HYDX.750', name: '2003-2018 Cummins Clutch Master Cylinder', platformSlug: 'cummins', priceCents: 52805, description: 'South Bend Clutch Clutch Master Cylinder for 2003-2018 Cummins trucks. OEM-fit replacement part, part #HYDX.750.' },
  { id: 'southbend-sdd3250-gk', sku: 'SDD3250-GK', name: '2005.5-2018 Cummins Stage 3 Organic/Ceramic Clutch Kit - 650HP', platformSlug: 'cummins', priceCents: 247775, description: 'South Bend Clutch Clutch Kit for 2005.5-2018 Cummins trucks. OEM-fit replacement part, part #SDD3250-GK.' },
  { id: 'southbend-hydx1-50', sku: 'HYDX1.50', name: '1998-2002 Cummins Clutch Master Cylinder', platformSlug: 'cummins', priceCents: 52805, description: 'South Bend Clutch Clutch Master Cylinder for 1998-2002 Cummins trucks. OEM-fit replacement part, part #HYDX1.50.' },
  { id: 'southbend-g56-ofek', sku: 'G56-OFEK', name: '2005.5-2018 Cummins Stage 2 Organic/Feramic Clutch Kit - 475HP', platformSlug: 'cummins', priceCents: 215280, description: 'South Bend Clutch Clutch Kit for 2005.5-2018 Cummins trucks. OEM-fit replacement part, part #G56-OFEK.' },
  { id: 'southbend-nv4500starterspacerwbolts', sku: 'NV4500STARTERSPACERWBOLTS', name: '1994-2004 Cummins South Bend NV4500 Starter Spacer', platformSlug: 'cummins', priceCents: 5801, description: 'South Bend Clutch Starter Spacer for 1994-2004 Cummins trucks. OEM-fit replacement part, part #NV4500STARTERSPACERWBOLTS.' },
  { id: 'southbend-hydx-max', sku: 'HYDX-MAX', name: '2001-2005 Duramax Hydraulic Throw-Out Bearing', platformSlug: 'duramax', priceCents: 28433, description: 'South Bend Clutch Throw-Out Bearing for 2001-2005 Duramax trucks. OEM-fit replacement part, part #HYDX-MAX.' },
  { id: 'southbend-sdd3250-gk-org', sku: 'SDD3250-GK-ORG', name: '2005.5-2018 Cummins Stage 3 Organic Clutch Kit - 550HP', platformSlug: 'cummins', priceCents: 247775, description: 'South Bend Clutch Clutch Kit for 2005.5-2018 Cummins trucks. OEM-fit replacement part, part #SDD3250-GK-ORG.' },
  { id: 'southbend-13125-ok-hd', sku: '13125-OK-HD', name: '1994-2004 Cummins HD Organic 13" Clutch Kit - 425HP', platformSlug: 'cummins', priceCents: 138104, description: 'South Bend Clutch Clutch Kit for 1994-2004 Cummins trucks. OEM-fit replacement part, part #13125-OK-HD.' },
  { id: 'southbend-sdd3250-6', sku: 'SDD3250-6', name: '2000.5-2005.5 Cummins Stage Organic/Ceramic 4 Clutch Kit - 650HP', platformSlug: 'cummins', priceCents: 194970, description: 'South Bend Clutch Clutch Kit for 2000.5-2005.5 Cummins trucks. OEM-fit replacement part, part #SDD3250-6.' },
  { id: 'southbend-g56-ok-hd', sku: 'g56-ok-hd', name: '2005.5-2018 Cummins HD 13" Clutch Kit 425hp', platformSlug: 'cummins', priceCents: 199032, description: 'South Bend Clutch Clutch Kit for 2005.5-2018 Cummins trucks. OEM-fit replacement part, part #g56-ok-hd.' },
  { id: 'southbend-13125-ofek', sku: '13125-OFEK', name: '1988-2004 Cummins 5.9L - HD 13" Clutch Kit 475hp', platformSlug: 'cummins', priceCents: 154352, description: 'South Bend Clutch Clutch Kit for 1988-2004 Cummins trucks. OEM-fit replacement part, part #13125-OFEK.' },
  { id: 'southbend-sdd3250-g-org', sku: 'SDD3250-G-ORG', name: '2005.5-2018 Cummins Organic Street Dual Disc Clutch Kit - 550hp', platformSlug: 'cummins', priceCents: 194970, description: 'South Bend Clutch Clutch Kit for 2005.5-2018 Cummins trucks. OEM-fit replacement part, part #SDD3250-G-ORG.' },
  { id: 'southbend-sdd3250-g', sku: 'SDD3250-G', name: '2005.5-2016 Cummins Stage 3 Organic/Ceramic Clutch Kit - 650HP', platformSlug: 'cummins', priceCents: 194970, description: 'South Bend Clutch Clutch Kit for 2005.5-2016 Cummins trucks. OEM-fit replacement part, part #SDD3250-G.' },
  { id: 'southbend-getragstarterspacer', sku: 'GETRAGSTARTERSPACER', name: '1988-1993 Cummins Getrag Starter Spacer', platformSlug: 'cummins', priceCents: 5836, description: 'South Bend Clutch Starter Spacer for 1988-1993 Cummins trucks. OEM-fit replacement part, part #GETRAGSTARTERSPACER.' },
  { id: 'southbend-1947-okhd', sku: '1947-OKHD', name: '2000.5-2005.5 Cummins Stage 2 Organic Clutch Kit - 425HP', platformSlug: 'cummins', priceCents: 138104, description: 'South Bend Clutch Clutch Kit for 2000.5-2005.5 Cummins trucks. OEM-fit replacement part, part #1947-OKHD.' },
  { id: 'southbend-13125-ok', sku: '13125-OK', name: '1988-2004 Cummins 5.9L - Upgraded Clutch Kit W/ Flywheel', platformSlug: 'cummins', priceCents: 121857, description: 'South Bend Clutch Clutch Kit for 1988-2004 Cummins trucks. OEM-fit replacement part, part #13125-OK.' },
  { id: 'southbend-1947-ok', sku: '1947-OK', name: '2000.5-2005.5 Cummins Stage 1 Organic Clutch -400HP', platformSlug: 'cummins', priceCents: 121857, description: 'South Bend Clutch Clutch Kit for 2000.5-2005.5 Cummins trucks. OEM-fit replacement part, part #1947-OK.' },
  { id: 'southbend-1944-6or-hd', sku: '1944-6OR-HD', name: '1999-2003.5 Powerstroke Stage 3 Organic Clutch - 425HP', platformSlug: 'powerstroke', priceCents: 97485, description: 'South Bend Clutch Clutch Kit for 1999-2003.5 Powerstroke trucks. OEM-fit replacement part, part #1944-6OR-HD.' },
  { id: 'southbend-1944-6ofek', sku: '1944-6OFEK', name: '1999-2003.5 Powerstroke Stage 3 Feramic/Organic Clutch - 475HP', platformSlug: 'powerstroke', priceCents: 154352, description: 'South Bend Clutch Clutch Kit for 1999-2003.5 Powerstroke trucks. OEM-fit replacement part, part #1944-6OFEK.' },
  { id: 'southbend-sddmaxz-org', sku: 'SDDMAXZ-ORG', name: '2005-2006 Duramax Stage 3 Organic Clutch Kit', platformSlug: 'duramax', priceCents: 160632, description: 'South Bend Clutch Clutch Kit for 2005-2006 Duramax trucks. OEM-fit replacement part, part #SDDMAXZ-ORG.' },
  { id: 'southbend-sdm506dfk', sku: 'SDM506DFK', name: '2005-2006 Duramax Stage 2 CB/Kevlar Clutch Kit', platformSlug: 'duramax', priceCents: 148362, description: 'South Bend Clutch Clutch Kit for 2005-2006 Duramax trucks. OEM-fit replacement part, part #SDM506DFK.' },
  { id: 'southbend-sdd3250-5-org', sku: 'SDD3250-5-ORG', name: '1999-2000.5 Cummins NV5600 Stage 4 Organic Clutch Kit - 550HP', platformSlug: 'cummins', priceCents: 194970, description: 'South Bend Clutch Clutch Kit for 1999-2000.5 Cummins trucks. OEM-fit replacement part, part #SDD3250-5-ORG.' },
  { id: 'southbend-1947-ohd', sku: '1947-OHD', name: '2000.5-2005.5 Cummins Stage 2 Organic Clutch - 425HP', platformSlug: 'cummins', priceCents: 95108, description: 'South Bend Clutch Clutch Kit for 2000.5-2005.5 Cummins trucks. OEM-fit replacement part, part #1947-OHD.' },
  { id: 'southbend-1950-60dfk', sku: '1950-60DFK', name: '2004-2007 Powerstroke Stage CB/Kevlar 2 Clutch Kit - 425HP', platformSlug: 'powerstroke', priceCents: 146229, description: 'South Bend Clutch Clutch Kit for 2004-2007 Powerstroke trucks. OEM-fit replacement part, part #1950-60DFK.' },
  { id: 'southbend-1944-6or', sku: '1944-6OR', name: '1999-2003.5 Powerstroke Stage 1 Organic Clutch - 400HP', platformSlug: 'powerstroke', priceCents: 81238, description: 'South Bend Clutch Clutch Kit for 1999-2003.5 Powerstroke trucks. OEM-fit replacement part, part #1944-6OR.' },
  { id: 'southbend-1944-5ofek', sku: '1944-5OFEK', name: '1994-1998 Powerstroke Stage 3 Organic/Feramic Clutch Kit -475HP', platformSlug: 'powerstroke', priceCents: 154352, description: 'South Bend Clutch Clutch Kit for 1994-1998 Powerstroke trucks. OEM-fit replacement part, part #1944-5OFEK.' },
  { id: 'southbend-1939-df', sku: '1939-DF', name: '1999-2003.5 Powerstroke Stage 2 Ceramic/Kevlar Clutch - 425HP', platformSlug: 'powerstroke', priceCents: 101547, description: 'South Bend Clutch Clutch Kit for 1999-2003.5 Powerstroke trucks. OEM-fit replacement part, part #1939-DF.' },
  { id: 'southbend-sddmax-dfz', sku: 'SDDMAX-DFZ', name: '2005-2006 Duramax Stage 3 Organic Clutch Kit - 650HP', platformSlug: 'duramax', priceCents: 194970, description: 'South Bend Clutch Clutch Kit for 2005-2006 Duramax trucks. OEM-fit replacement part, part #SDDMAX-DFZ.' },
  { id: 'southbend-sdd3250-5k-org', sku: 'SDD3250-5K-ORG', name: '1994-2004 Cummins Stage 4 Organic Clutch Kit - 550HP', platformSlug: 'cummins', priceCents: 259961, description: 'South Bend Clutch Clutch Kit for 1994-2004 Cummins trucks. OEM-fit replacement part, part #SDD3250-5K-ORG.' },
  { id: 'southbend-1670507-6', sku: '1670507-6', name: '2005-2016 Cummins Flywheel', platformSlug: 'cummins', priceCents: 66763, description: 'South Bend Clutch Flywheel for 2005-2016 Cummins trucks. OEM-fit replacement part, part #1670507-6.' },
  { id: 'southbend-sfdd3250-6-4-org', sku: 'SFDD3250-6.4-ORG', name: '2008-2010 Powerstroke Stage 3 Organic Clutch Kit', platformSlug: 'powerstroke', priceCents: 194970, description: 'South Bend Clutch Clutch Kit for 2008-2010 Powerstroke trucks. OEM-fit replacement part, part #SFDD3250-6.4-ORG.' },
  { id: 'southbend-sfdd325060org', sku: 'SFDD325060ORG', name: '2004-2007 Powerstroke Stage Organic 3 Clutch Kit - 550HP', platformSlug: 'powerstroke', priceCents: 178034, description: 'South Bend Clutch Clutch Kit for 2004-2007 Powerstroke trucks. OEM-fit replacement part, part #SFDD325060ORG.' },
  { id: 'southbend-sfdd3250-6-4', sku: 'SFDD3250-6.4', name: '2008-2010 Powerstroke Stage 3 Organic/Ceramic Clutch Kit - 650HP', platformSlug: 'powerstroke', priceCents: 178034, description: 'South Bend Clutch Clutch Kit for 2008-2010 Powerstroke trucks. OEM-fit replacement part, part #SFDD3250-6.4.' },
  { id: 'southbend-g56-ofer', sku: 'G56-OFER', name: '2005.5-2018 Cummins Stage 2 Organic/Feramic Clutch Kit - 475HP', platformSlug: 'cummins', priceCents: 121857, description: 'South Bend Clutch Clutch Kit for 2005.5-2018 Cummins trucks. OEM-fit replacement part, part #G56-OFER.' },
  { id: 'southbend-1944-5k', sku: '1944-5K', name: '1994-1998 Powerstroke Stage 1 Organic Clutch Kit', platformSlug: 'powerstroke', priceCents: 97485, description: 'South Bend Clutch Clutch Kit for 1994-1998 Powerstroke trucks. OEM-fit replacement part, part #1944-5K.' },
  { id: 'southbend-1947-ofe', sku: '1947-OFE', name: '2000.5-2005 Cummins Stage 3 Organic/Feramic Clutch - 475HP', platformSlug: 'cummins', priceCents: 118885, description: 'South Bend Clutch Clutch Kit for 2000.5-2005 Cummins trucks. OEM-fit replacement part, part #1947-OFE.' },
  { id: 'southbend-sfdd3250-5-org', sku: 'SFDD3250-5-ORG', name: '1994-1998 Powerstroke Stage 4 Organic Clutch Kit - 550HP', platformSlug: 'powerstroke', priceCents: 194970, description: 'South Bend Clutch Clutch Kit for 1994-1998 Powerstroke trucks. OEM-fit replacement part, part #SFDD3250-5-ORG.' },
  { id: 'southbend-1939ohd', sku: '1939OHD', name: '1999-2003.5 Powerstroke Stage 2 Organic Clutch - 425HP', platformSlug: 'powerstroke', priceCents: 95240, description: 'South Bend Clutch Clutch Kit for 1999-2003.5 Powerstroke trucks. OEM-fit replacement part, part #1939OHD.' },
  { id: 'southbend-1947-o', sku: '1947-O', name: '2000.5-2005 Cummins Stage 1 Organic Clutch - 400HP', platformSlug: 'cummins', priceCents: 79257, description: 'South Bend Clutch Clutch Kit for 2000.5-2005 Cummins trucks. OEM-fit replacement part, part #1947-O.' },
  { id: 'southbend-13125-or', sku: '13125-OR', name: '1988-2004 Cummins 13" Organic Clutch Kit - 400hp', platformSlug: 'cummins', priceCents: 81238, description: 'South Bend Clutch Clutch Kit for 1988-2004 Cummins trucks. OEM-fit replacement part, part #13125-OR.' },
  { id: 'southbend-sdd3250-5g', sku: 'SDD3250-5G', name: '1989-1993 Cummins Stage 4 Organic/Ceramic Clutch Kit - 650hp / 1300lbs', platformSlug: 'cummins', priceCents: 194970, description: 'South Bend Clutch Clutch Kit for 1989-1993 Cummins trucks. OEM-fit replacement part, part #SDD3250-5G.' },
  { id: 'southbend-sfdd3250-6-org', sku: 'SFDD3250-6-ORG', name: '1999-2003.5 Powerstroke Stage 4 Organic Clutch Kit - 550HP', platformSlug: 'powerstroke', priceCents: 194970, description: 'South Bend Clutch Clutch Kit for 1999-2003.5 Powerstroke trucks. OEM-fit replacement part, part #SFDD3250-6-ORG.' },
  { id: 'southbend-sfdd3250-6-0', sku: 'SFDD3250-6.0', name: '2004-2007 Powerstroke Stage 3 Organic/Ceramic Clutch Kit - 650HP', platformSlug: 'powerstroke', priceCents: 194970, description: 'South Bend Clutch Clutch Kit for 2004-2007 Powerstroke trucks. OEM-fit replacement part, part #SFDD3250-6.0.' },
  { id: 'southbend-sfdd3250-5', sku: 'SFDD3250-5', name: '1994-1998 Powerstroke Stage 4 Organic/Ceramic Clutch Kit - 650HP', platformSlug: 'powerstroke', priceCents: 194970, description: 'South Bend Clutch Clutch Kit for 1994-1998 Powerstroke trucks. OEM-fit replacement part, part #SFDD3250-5.' },
  { id: 'southbend-1950-64ok-hd', sku: '1950-64OK-HD', name: '2008-2010 Powerstroke Stage 1 Organic Clutch Kit - 425HP', platformSlug: 'powerstroke', priceCents: 138104, description: 'South Bend Clutch Clutch Kit for 2008-2010 Powerstroke trucks. OEM-fit replacement part, part #1950-64OK-HD.' },
  { id: 'southbend-1950-64cbk', sku: '1950-64CBK', name: '2008-2010 Powerstroke Stage 2 Ceramic Clutch Kit - 450HP', platformSlug: 'powerstroke', priceCents: 146229, description: 'South Bend Clutch Clutch Kit for 2008-2010 Powerstroke trucks. OEM-fit replacement part, part #1950-64CBK.' },
  { id: 'southbend-1950-60cbk', sku: '1950-60CBK', name: '2004-2007 Powerstroke Stage 2 Ceramic Clutch Kit - 450HP', platformSlug: 'powerstroke', priceCents: 146229, description: 'South Bend Clutch Clutch Kit for 2004-2007 Powerstroke trucks. OEM-fit replacement part, part #1950-60CBK.' },
  { id: 'southbend-1944-5or-hd', sku: '1944-5OR-HD', name: '1993-1998 Powerstroke Stage 2 Organic Clutch - 425HP', platformSlug: 'powerstroke', priceCents: 97485, description: 'South Bend Clutch Clutch Kit for 1993-1998 Powerstroke trucks. OEM-fit replacement part, part #1944-5OR-HD.' },
  { id: 'southbend-1939-cb', sku: '1939-CB', name: '1999-2003.5 Powerstroke Stage 2 Ceramic Clutch - 450HP', platformSlug: 'powerstroke', priceCents: 101547, description: 'South Bend Clutch Clutch Kit for 1999-2003.5 Powerstroke trucks. OEM-fit replacement part, part #1939-CB.' },
  { id: 'southbend-10701066-2', sku: '10701066-2', name: '2005-2006 Duramax Flywheel', platformSlug: 'duramax', priceCents: 89017, description: 'South Bend Clutch Flywheel for 2005-2006 Duramax trucks. OEM-fit replacement part, part #10701066-2.' },
  { id: 'southbend-1670104-6', sku: '1670104-6', name: '2000.5-2005 Cummins Flywheel', platformSlug: 'cummins', priceCents: 66763, description: 'South Bend Clutch Flywheel for 2000.5-2005 Cummins trucks. OEM-fit replacement part, part #1670104-6.' },
  { id: 'southbend-13125-ofer', sku: '13125-OFER', name: '1988-2004 Cummins Stage 3 Organic/Feramic Clutch - 475HP', platformSlug: 'cummins', priceCents: 121857, description: 'South Bend Clutch Clutch Kit for 1988-2004 Cummins trucks. OEM-fit replacement part, part #13125-OFER.' },
  { id: 'southbend-13125-fer', sku: '13125-fer', name: '1988-2004 Cummins Stage 3 Feramic Clutch - 550HP-No Flywheel', platformSlug: 'cummins', priceCents: 138104, description: 'South Bend Clutch Clutch Kit for 1988-2004 Cummins trucks. OEM-fit replacement part, part #13125-fer.' },
  { id: 'southbend-1947-or-hd', sku: '1947-OR-HD', name: '2000-2005 Cummins 5.9L South Bend Stage 2 Daily Plus Clutch Kit', platformSlug: 'cummins', priceCents: 97485, description: 'South Bend Clutch Clutch Kit for 2000-2005 Cummins trucks. OEM-fit replacement part, part #1947-OR-HD.' },
  { id: 'southbend-fc-6okhd', sku: 'FC-6OKHD', name: '1999-2003 Powerstroke Clutch Kit', platformSlug: 'powerstroke', priceCents: 138104, description: 'South Bend Clutch Clutch Kit for 1999-2003 Powerstroke trucks. OEM-fit replacement part, part #FC-6OKHD.' },
  { id: 'southbend-1947-ofer', sku: '1947-OFER', name: '2000.5-2005.5 Cummins Dyna Max Clutch Kit', platformSlug: 'cummins', priceCents: 121857, description: 'South Bend Clutch Clutch Kit for 2000.5-2005.5 Cummins trucks. OEM-fit replacement part, part #1947-OFER.' },
  { id: 'southbend-1944-6r', sku: '1944-6R', name: '1999-2003.5 Powerstroke Stage 1 Organic Clutch', platformSlug: 'powerstroke', priceCents: 64990, description: 'South Bend Clutch Clutch Kit for 1999-2003.5 Powerstroke trucks. OEM-fit replacement part, part #1944-6R.' },
  { id: 'southbend-1944-6ofer', sku: '1944-6OFER', name: '1999-2003.5 Powerstroke Stage 3 Organic/Feramic Clutch -475HP', platformSlug: 'powerstroke', priceCents: 121857, description: 'South Bend Clutch Clutch Kit for 1999-2003.5 Powerstroke trucks. OEM-fit replacement part, part #1944-6OFER.' },
  { id: 'southbend-1944-5or', sku: '1944-5OR', name: '1993-1998 Powerstroke Stage 2 Organic Clutch - 400HP', platformSlug: 'powerstroke', priceCents: 81238, description: 'South Bend Clutch Clutch Kit for 1993-1998 Powerstroke trucks. OEM-fit replacement part, part #1944-5OR.' },
  { id: 'southbend-1944-5ofer', sku: '1944-5OFER', name: '1994-1998 Powerstroke Stage 3 Organic/Feramic Clutch - 475HP', platformSlug: 'powerstroke', priceCents: 121857, description: 'South Bend Clutch Clutch Kit for 1994-1998 Powerstroke trucks. OEM-fit replacement part, part #1944-5OFER.' },
  { id: 'southbend-10701066-1', sku: '10701066-1', name: '2001-2005 Duramax 6.6L Flywheel', platformSlug: 'duramax', priceCents: 89017, description: 'South Bend Clutch Flywheel for 2001-2005 Duramax trucks. OEM-fit replacement part, part #10701066-1.' },
  { id: 'southbend-sdm0506ok', sku: 'SDM0506OK', name: '2005-2006 Duramax Stage 1 Organic Clutch Kit - 375HP', platformSlug: 'duramax', priceCents: 146229, description: 'South Bend Clutch Clutch Kit for 2005-2006 Duramax trucks. OEM-fit replacement part, part #SDM0506OK.' },
  { id: 'southbend-hydx-f6-0-6-4', sku: 'HYDX-F6.0-6.4', name: '2004-2010 Powerstroke Slave Master Cylinder', platformSlug: 'powerstroke', priceCents: 34932, description: 'South Bend Clutch Clutch Master Cylinder for 2004-2010 Powerstroke trucks. OEM-fit replacement part, part #HYDX-F6.0-6.4.' },
  { id: 'southbend-hydx-f67-3', sku: 'HYDX-F67.3', name: '1999-2003.5 Powerstroke Slave Master Cylinder', platformSlug: 'powerstroke', priceCents: 34932, description: 'South Bend Clutch Clutch Master Cylinder for 1999-2003.5 Powerstroke trucks. OEM-fit replacement part, part #HYDX-F67.3.' },
  { id: 'southbend-1947-ofek', sku: '1947-OFEK', name: '2000.5-2005 Cummins Stage 3 Organic/Feramic Clutch Kit - 475HP', platformSlug: 'cummins', priceCents: 154352, description: 'South Bend Clutch Clutch Kit for 2000.5-2005 Cummins trucks. OEM-fit replacement part, part #1947-OFEK.' },
  { id: 'southbend-1944-5ok', sku: '1944-5OK', name: '1994-1998 Powerstroke Stage 2 Organic Clutch Kit - 400HP', platformSlug: 'powerstroke', priceCents: 121857, description: 'South Bend Clutch Clutch Kit for 1994-1998 Powerstroke trucks. OEM-fit replacement part, part #1944-5OK.' },
  { id: 'southbend-1944-6ok-hd', sku: '1944-6OK-HD', name: '1999-2003.5 Powerstroke Stage 3 Organic Clutch Kit - 425HP', platformSlug: 'powerstroke', priceCents: 138104, description: 'South Bend Clutch Clutch Kit for 1999-2003.5 Powerstroke trucks. OEM-fit replacement part, part #1944-6OK-HD.' },
  { id: 'southbend-1944-6ok', sku: '1944-6OK', name: '1999-2003.5 Powerstroke Stage 1 Organic Clutch Kit - 400HP', platformSlug: 'powerstroke', priceCents: 121857, description: 'South Bend Clutch Clutch Kit for 1999-2003.5 Powerstroke trucks. OEM-fit replacement part, part #1944-6OK.' },
  { id: 'southbend-sdd3250-6-org', sku: 'SDD3250-6-ORG', name: '2000.5-2005.5 Cummins Stage 4 Organic Clutch Kit - 550HP', platformSlug: 'cummins', priceCents: 194970, description: 'South Bend Clutch Clutch Kit for 2000.5-2005.5 Cummins trucks. OEM-fit replacement part, part #SDD3250-6-ORG.' },
  { id: 'southbend-g56-or-hd', sku: 'G56-OR-HD', name: '2005.5-2018 Cummins Stage 1 Organic Clutch - 425HP', platformSlug: 'cummins', priceCents: 97485, description: 'South Bend Clutch Clutch Kit for 2005.5-2018 Cummins trucks. OEM-fit replacement part, part #G56-OR-HD.' },
  { id: 'southbend-sddmax-dfy', sku: 'SDDMAX-DFY', name: '2001-2006 Duramax Stage 3 Organic/Ceramic Clutch Kit - 650HP', platformSlug: 'duramax', priceCents: 194970, description: 'South Bend Clutch Clutch Kit for 2001-2006 Duramax trucks. OEM-fit replacement part, part #SDDMAX-DFY.' },
  { id: 'southbend-hyd-hd', sku: 'HYD-HD', name: '1994-1997 Cummins Clutch Master Cylinder', platformSlug: 'cummins', priceCents: 52805, description: 'South Bend Clutch Clutch Master Cylinder for 1994-1997 Cummins trucks. OEM-fit replacement part, part #HYD-HD.' },
  { id: 'southbend-isk1-375', sku: 'ISK1.375', name: '1994-2005 Cummins NV4500 Upgraded Input Shaft', platformSlug: 'cummins', priceCents: 64990, description: 'South Bend Clutch Drivetrain Component for 1994-2005 Cummins trucks. OEM-fit replacement part, part #ISK1.375.' },
  { id: 'southbend-1944-6k', sku: '1944-6K', name: '1999-2003.5 Powerstroke OEM Clutch', platformSlug: 'powerstroke', priceCents: 97485, description: 'South Bend Clutch Clutch Kit for 1999-2003.5 Powerstroke trucks. OEM-fit replacement part, part #1944-6K.' },
  { id: 'southbend-sddmaxy-org', sku: 'SDDMAXY-ORG', name: '2001-2005 Duramax Stage 3 Organic Clutch Kit - 550HP', platformSlug: 'duramax', priceCents: 194970, description: 'South Bend Clutch Clutch Kit for 2001-2005 Duramax trucks. OEM-fit replacement part, part #SDDMAXY-ORG.' },
  { id: 'southbend-1944-5ok-hd', sku: '1944-5OK-HD', name: '1994-1998 Powerstroke Stage 2 Organic Clutch Kit - 425HP', platformSlug: 'powerstroke', priceCents: 138104, description: 'South Bend Clutch Clutch Kit for 1994-1998 Powerstroke trucks. OEM-fit replacement part, part #1944-5OK-HD.' },
  { id: 'southbend-sfdd3250-6', sku: 'SFDD3250-6', name: '1999-2003.5 Powerstroke Stage 4 Organic/Ceramic Clutch Kit - 650HP', platformSlug: 'powerstroke', priceCents: 194970, description: 'South Bend Clutch Clutch Kit for 1999-2003.5 Powerstroke trucks. OEM-fit replacement part, part #SFDD3250-6.' },
  { id: 'southbend-13125-or-hd', sku: '13125-OR-HD', name: '1988-2004 Cummins Stage 2 Organic Clutch - 425HP', platformSlug: 'cummins', priceCents: 97485, description: 'South Bend Clutch Clutch Kit for 1988-2004 Cummins trucks. OEM-fit replacement part, part #13125-OR-HD.' },
  { id: 'southbend-13125-fek', sku: '13125-fek', name: '1988-2004 Cummins Stage 3 Feramic Clutch Kit - 550HP', platformSlug: 'cummins', priceCents: 170599, description: 'South Bend Clutch Clutch Kit for 1988-2004 Cummins trucks. OEM-fit replacement part, part #13125-fek.' },
  { id: 'southbend-0090', sku: '0090', name: '1994-2005 Cummins 5.9L - Stock Replacement Clutch', platformSlug: 'cummins', priceCents: 67368, description: 'South Bend Clutch Clutch Kit for 1994-2005 Cummins trucks. OEM-fit replacement part, part #0090.' },
];

export function seedSouthBendProducts() {
  db.prepare(`
    INSERT OR IGNORE INTO categories (slug, name, blurb, icon)
    VALUES ('drivetrain', 'Clutches & Drivetrain', 'Clutch kits, master cylinders, flywheels, and drivetrain hardware', 'clutch')
  `).run();

  const insert = db.prepare(`
    INSERT OR IGNORE INTO products
      (id, sku, name, brand, category_slug, platform_slug, price_cents, description, weight_lbs, supplier, active, stock_qty)
    VALUES
      (@id, @sku, @name, 'South Bend Clutch', 'drivetrain', @platformSlug, @priceCents, @description, NULL, 'South Bend Clutch', 1, 3)
  `);
  const updateName = db.prepare(`UPDATE products SET name = @name WHERE id = @id AND brand = 'South Bend Clutch'`);

  let inserted = 0;
  for (const p of SOUTH_BEND_PRODUCTS) {
    try {
      const info = insert.run(p);
      if (info.changes > 0) inserted++;
    } catch (err) {
      console.error('[seedSouthBendProducts] insert failed for', p.id, '-', err.message);
    }
    try {
      updateName.run({ id: p.id, name: p.name });
    } catch (err) {
      console.error('[seedSouthBendProducts] update failed for', p.id, '-', err.message);
    }
  }

  const sbCount = db.prepare(`SELECT COUNT(*) AS c FROM products WHERE brand = 'South Bend Clutch'`).get().c;
  console.log(`[seedSouthBendProducts] inserted ${inserted}/${SOUTH_BEND_PRODUCTS.length} new rows this run; ${sbCount} South Bend Clutch rows total in DB now.`);
}

// No Limit Fabrication — product images.
// Sourced directly from nolimitfabrication.com's own individual product
// pages (not category-grid thumbnails, not a reseller) — each URL below
// was pulled from that exact SKU's own page on their site, matched by
// name/year-range/platform. Same safety pattern as seedP1rpImages(): only
// fills in a photo where image_url is currently empty, so it will never
// clobber a photo you've since replaced in Admin -> Products.
const NO_LIMIT_IMAGE_MAP = {
  'nolimit-whistler-1519': 'https://nolimitfabrication.com/images/M198753044.jpg',
  'nolimit-whistler-1114': 'https://nolimitfabrication.com/images/M198752890.jpg',
  'nolimit-67-compound': 'https://nolimitfabrication.com/images/M198752389.jpg',
  'nolimit-whistler-0307': 'https://nolimitfabrication.com/images/M198752674.jpg',
  'nolimit-retrofit-1114': 'https://nolimitfabrication.com/images/M198750959.jpg',
  'nolimit-duramax-llylmm-turbo': 'https://nolimitfabrication.com/images/M198752424.jpg',
  'nolimit-turbo-blanket': 'https://nolimitfabrication.com/images/M198752214.jpg',
  'nolimit-67-ballbearing': 'https://nolimitfabrication.com/images/M198752649.jpg',
  'nolimit-intake-2026': 'https://nolimitfabrication.com/images/F198752153.png',
  'nolimit-intake-1719-s2': 'https://nolimitfabrication.com/images/M198751187.jpg',
  'nolimit-intake-1116-s2': 'https://nolimitfabrication.com/images/M198751190.jpg',
  'nolimit-intake-1116-s1': 'https://nolimitfabrication.com/images/M198751171.jpg',
  'nolimit-intake-1719-s1': 'https://nolimitfabrication.com/images/M198751173.jpg',
  'nolimit-intake-0810': 'https://nolimitfabrication.com/images/M198752227.jpg',
  'nolimit-intake-60': 'https://nolimitfabrication.com/images/M198752683.jpg',
  'nolimit-intake-closedbox-1719': 'https://nolimitfabrication.com/images/F198751114.jpg',
  'nolimit-intake-premium-1116': 'https://nolimitfabrication.com/images/F198751033.png',
  'nolimit-intake-30': 'https://nolimitfabrication.com/images/M198742789.jpg',
  'nolimit-custom-filter': 'https://nolimitfabrication.com/images/M198751003.jpg',
  'nolimit-prefilter': 'https://nolimitfabrication.com/images/M198752004.jpg',
  'nolimit-boost-bundle-67': 'https://nolimitfabrication.com/images/M198753040.jpg',
  'nolimit-hf-bundle-67': 'https://nolimitfabrication.com/images/M198752908.jpg',
  'nolimit-hf-bundle-64': 'https://nolimitfabrication.com/images/M198752907.jpg',
  'nolimit-hf-bundle-60': 'https://nolimitfabrication.com/images/M198752905.jpg',
  'nolimit-ic-piping-67': 'https://nolimitfabrication.com/images/M198753067.jpg',
  'nolimit-a2w-stage2-67': 'https://nolimitfabrication.com/images/M198752894.jpg',
  'nolimit-a2w-stage1-67': 'https://nolimitfabrication.com/images/M198752403.jpg',
  'nolimit-hotside-67': 'https://nolimitfabrication.com/images/M198752494.jpg',
  'nolimit-coldside-67': 'https://nolimitfabrication.com/images/M198752883.jpg',
  'nolimit-coldside-60': 'https://nolimitfabrication.com/images/M198752735.jpg',
  'nolimit-hotside-60': 'https://nolimitfabrication.com/images/M198752700.jpg',
  'nolimit-hotpipe-64': 'https://nolimitfabrication.com/images/M198752787.jpg',
  'nolimit-coldside-64': 'https://nolimitfabrication.com/images/M198752520.jpg',
  'nolimit-downpipe-1114': 'https://nolimitfabrication.com/images/M198752941.jpg',
  'nolimit-downpipe-1519': 'https://nolimitfabrication.com/images/M198751117.jpg',
  'nolimit-downpipe-2022': 'https://nolimitfabrication.com/images/M198752632.jpg',
  'nolimit-icbootset-60': 'https://nolimitfabrication.com/images/M198752598.jpg',
  'nolimit-icbootset-64': 'https://nolimitfabrication.com/images/M198751041.jpg',
  'nolimit-a2a-60': 'https://nolimitfabrication.com/images/M198752834.jpg',
  'nolimit-a2a-64': 'https://nolimitfabrication.com/images/M198752833.jpg',
  'nolimit-a2a-73': 'https://nolimitfabrication.com/images/M198752835.jpg',
  'nolimit-lower-ic-hose': 'https://nolimitfabrication.com/images/M198752306.jpg',
  'nolimit-sil-hose-2x3': 'https://nolimitfabrication.com/images/M198752433.jpg',
  'nolimit-sil-elbow-390': 'https://nolimitfabrication.com/images/M198752301.jpg',
  'nolimit-sil-red-335': 'https://nolimitfabrication.com/images/M198752477.jpg',
  'nolimit-sil-coupler-3x4': 'https://nolimitfabrication.com/images/M198752305.jpg',
  'nolimit-sil-coupler-3x6': 'https://nolimitfabrication.com/images/M198752302.jpg',
  'nolimit-sil-coupler-3258': 'https://nolimitfabrication.com/images/M198753066.jpg',
  'nolimit-hotside-boot-60': 'https://nolimitfabrication.com/images/M198752303.jpg',
  'nolimit-turbo-circ-line-23': 'https://nolimitfabrication.com/images/M198752912.jpg',
  'nolimit-coolant-line-1126': 'https://nolimitfabrication.com/images/M198751013.jpg',
  'nolimit-6r140-pan': 'https://nolimitfabrication.com/images/M198752954.jpg',
  'nolimit-oilpan-67': 'https://nolimitfabrication.com/images/F198752927.jpg',
  'nolimit-catch-can': 'https://nolimitfabrication.com/images/M198752124.jpg',
  'nolimit-venturi': 'https://nolimitfabrication.com/images/M198752126.jpg',
  'nolimit-diffcover-14bolt': 'https://nolimitfabrication.com/images/F198753073.jpg',
  'nolimit-sec-coolant-tank-67': 'https://nolimitfabrication.com/images/M198752348.jpg',
  'nolimit-cp4-bypass': 'https://nolimitfabrication.com/images/M198752602.jpg',
  'nolimit-primary-coolant-tank-67': 'https://nolimitfabrication.com/images/M198752400.jpg',
  'nolimit-uppercoolant-1126': 'https://nolimitfabrication.com/images/M198751031.jpg',
  'nolimit-uppercoolant-60': 'https://nolimitfabrication.com/images/M198752789.jpg',
  'nolimit-uppipe-64': 'https://nolimitfabrication.com/images/M198751028.jpg',
  'nolimit-coolanttank-64': 'https://nolimitfabrication.com/images/M198751040.jpg',
  'nolimit-pass-coolant-fix-64': 'https://nolimitfabrication.com/images/M198751012.jpg',
  'nolimit-oilcooler-reloc-67': 'https://nolimitfabrication.com/images/M198752498.jpg',
  'nolimit-battreloc-1719': 'https://nolimitfabrication.com/images/M198752321.jpg',
  'nolimit-capset-67': 'https://nolimitfabrication.com/images/M198751006.jpg',
  'nolimit-turbohoseboot-67': 'https://nolimitfabrication.com/images/M198751032.jpg',
  'nolimit-batteryholddowns': 'https://nolimitfabrication.com/images/M198752482.jpg',
  'nolimit-hotside-boot-kit-1126': 'https://nolimitfabrication.com/images/F198752448.jpg',
  'nolimit-deftankplate': 'https://nolimitfabrication.com/images/M198751039.jpg',
  'nolimit-10r140-pan': 'https://nolimitfabrication.com/images/M198753072.jpg',
  'nolimit-diffcover-12bolt-9916': 'https://nolimitfabrication.com/images/M198753063.jpg',
  'nolimit-diffcover-12bolt-99cur': 'https://nolimitfabrication.com/images/M198753050.jpg',
  'nolimit-reservoircap-67': 'https://nolimitfabrication.com/images/M198752680.jpg',
  'nolimit-rotaryswitch-1122': 'https://nolimitfabrication.com/images/M198752879.jpg',
  'nolimit-fuelsump': 'https://nolimitfabrication.com/images/F198751458.jpg',
  'nolimit-sec-coolant-line-1114': 'https://nolimitfabrication.com/images/M198752184.jpg',
  'nolimit-molded-hose-67': 'https://nolimitfabrication.com/images/M198752878.jpg',
  'nolimit-reverse-level-kit': 'https://nolimitfabrication.com/images/M198751047.jpg',
  'nolimit-traction-bars': 'https://nolimitfabrication.com/images/M198750884.jpg',
  'nolimit-bodymounts-0816': 'https://nolimitfabrication.com/images/M198753049.jpg',
  'nolimit-bodymounts-0307': 'https://nolimitfabrication.com/images/M198753048.jpg',
  'nolimit-radsupport-17': 'https://nolimitfabrication.com/images/M198753028.jpg',
  'nolimit-bodymounts-9903': 'https://nolimitfabrication.com/images/M198753046.jpg',
  'nolimit-bumpstop': 'https://nolimitfabrication.com/images/M198751011.jpg',
};

export function seedNoLimitImages() {
  const update = db.prepare(`
    UPDATE products SET image_url = @image_url
    WHERE id = @id AND brand = 'No Limit Fabrication' AND (image_url IS NULL OR image_url = '')
  `);
  let updated = 0;
  for (const [id, image_url] of Object.entries(NO_LIMIT_IMAGE_MAP)) {
    try {
      const info = update.run({ id, image_url });
      if (info.changes > 0) updated++;
    } catch (err) {
      console.error('[seedNoLimitImages] update failed for', id, '-', err.message);
    }
  }
  const total = Object.keys(NO_LIMIT_IMAGE_MAP).length;
  console.log(`[seedNoLimitImages] set image_url on ${updated}/${total} No Limit Fabrication rows this run.`);
}

// South Bend Clutch — product images.
// Sourced directly from southbendclutch.com's own Shopify JSON product feed
// (not Dirty Diesel, the reseller we used for pricing) — matched by finding
// the real part number as the image filename on their own product pages,
// which is the strongest possible signal since South Bend names many of
// their own image files after the exact part number. Only 48 of 80 have a
// confident match: South Bend's site is newer and many products (all the
// "1947-*" Cummins family, several "SFDD3250-6..." Powerstroke twin-discs,
// two slave master cylinders) simply don't have a photo uploaded yet on
// their end. Duramax got 0/9 — southbendclutch.com currently has ZERO
// Duramax products live in its catalog at all (not just missing photos),
// confirmed by paginating their full site-wide product feed. Two matches
// (SFDD3250-5 and SFDD3250-5-ORG) are lower-confidence: the image filename
// uses an "FC3250-5" prefix instead of "SFDD3250-5", but the numeric core,
// platform, and HP tier all line up and no better candidate exists.
// Same safety pattern as the other seedXImages() functions: only fills in
// image_url where currently empty.
const SOUTH_BEND_IMAGE_MAP = {
  'southbend-sdd3250-gk': 'https://cdn.shopify.com/s/files/1/0887/5904/2341/files/SDD3250-GK.jpg?v=1765453272',
  'southbend-sdd3250-gk-org': 'https://cdn.shopify.com/s/files/1/0887/5904/2341/files/SDD3250-GK-ORG.jpg?v=1765453270',
  'southbend-sdd3250-g': 'https://cdn.shopify.com/s/files/1/0887/5904/2341/files/SDD3250-G.jpg?v=1765453267',
  'southbend-sdd3250-g-org': 'https://cdn.shopify.com/s/files/1/0887/5904/2341/files/SDD3250-G-ORG.jpg?v=1765453265',
  'southbend-sdd3250-6': 'https://cdn.shopify.com/s/files/1/0887/5904/2341/files/SDD3250-6.jpg?v=1765453263',
  'southbend-sdd3250-6-org': 'https://cdn.shopify.com/s/files/1/0887/5904/2341/files/SDD3250-6-ORG.jpg?v=1765453260',
  'southbend-sdd3250-5-org': 'https://cdn.shopify.com/s/files/1/0887/5904/2341/files/SDD3250-5-ORG.jpg?v=1765453244',
  'southbend-sdd3250-5k-org': 'https://cdn.shopify.com/s/files/1/0887/5904/2341/files/SDD3250-5K-ORG.jpg?v=1765453254',
  'southbend-sdd3250-5g': 'https://cdn.shopify.com/s/files/1/0887/5904/2341/files/SDD3250-5G.jpg?v=1765453252',
  'southbend-13125-ok': 'https://cdn.shopify.com/s/files/1/0887/5904/2341/files/13125-OK.jpg?v=1765386938',
  'southbend-13125-ok-hd': 'https://cdn.shopify.com/s/files/1/0887/5904/2341/files/13125-OK-HD.jpg?v=1765386935',
  'southbend-13125-ofek': 'https://cdn.shopify.com/s/files/1/0887/5904/2341/files/13125-OFEK.jpg?v=1765386933',
  'southbend-13125-fek': 'https://cdn.shopify.com/s/files/1/0887/5904/2341/files/13125-FEK.jpg?v=1765386930',
  'southbend-13125-or': 'https://cdn.shopify.com/s/files/1/0887/5904/2341/files/13125-OR_1.jpg?v=1765387760',
  'southbend-13125-or-hd': 'https://cdn.shopify.com/s/files/1/0887/5904/2341/files/13125-OR-HD_1.jpg?v=1765387758',
  'southbend-13125-fer': 'https://cdn.shopify.com/s/files/1/0887/5904/2341/files/13125-FER_1.jpg?v=1765387743',
  'southbend-13125-ofer': 'https://cdn.shopify.com/s/files/1/0887/5904/2341/files/13125-OFER_1.jpg?v=1765387748',
  'southbend-g56-ok-hd': 'https://cdn.shopify.com/s/files/1/0887/5904/2341/files/G56-OK-HD.jpg?v=1765387316',
  'southbend-g56-ofek': 'https://cdn.shopify.com/s/files/1/0887/5904/2341/files/G56-OFEK.jpg?v=1765387313',
  'southbend-g56-ofer': 'https://cdn.shopify.com/s/files/1/0887/5904/2341/files/G56-OFEK_1.jpg?v=1765388067',
  'southbend-g56-or-hd': 'https://cdn.shopify.com/s/files/1/0887/5904/2341/files/G56-OK-HD_1.jpg?v=1765388072',
  'southbend-hyd-hd': 'https://cdn.shopify.com/s/files/1/0887/5904/2341/files/HYD-HD.jpg?v=1765387321',
  'southbend-1944-6or-hd': 'https://cdn.shopify.com/s/files/1/0887/5904/2341/files/1944-6OK_2744381c-3783-41a6-a093-a7f3a978de26.jpg?v=1765386986',
  'southbend-1944-6ofek': 'https://cdn.shopify.com/s/files/1/0887/5904/2341/files/1944-6OFEK.jpg?v=1765386976',
  'southbend-1950-60dfk': 'https://cdn.shopify.com/s/files/1/0887/5904/2341/files/1950-60DFK.jpg?v=1765387004',
  'southbend-1944-6or': 'https://cdn.shopify.com/s/files/1/0887/5904/2341/files/1944-6OK_1.jpg?v=1765387814',
  'southbend-1944-5ofek': 'https://cdn.shopify.com/s/files/1/0887/5904/2341/files/1944-5OFEK.jpg?v=1765386960',
  'southbend-1944-5k': 'https://cdn.shopify.com/s/files/1/0887/5904/2341/files/1944-5K.jpg?v=1765386957',
  'southbend-sfdd3250-5-org': 'https://cdn.shopify.com/s/files/1/0887/5904/2341/files/FC3250-5-ORG.jpg?v=1765387128',
  'southbend-sfdd3250-5': 'https://cdn.shopify.com/s/files/1/0887/5904/2341/files/FC3250-5.jpg?v=1765387130',
  'southbend-1950-64ok-hd': 'https://cdn.shopify.com/s/files/1/0887/5904/2341/files/1950-64OK-HD.jpg?v=1765387017',
  'southbend-1950-64cbk': 'https://cdn.shopify.com/s/files/1/0887/5904/2341/files/1950-64CBK.jpg?v=1765387012',
  'southbend-1950-60cbk': 'https://cdn.shopify.com/s/files/1/0887/5904/2341/files/1950-60CBK.jpg?v=1765387002',
  'southbend-fc-6okhd': 'https://cdn.shopify.com/s/files/1/0887/5904/2341/files/FC-6OKHD.jpg?v=1765387122',
  'southbend-1944-6r': 'https://cdn.shopify.com/s/files/1/0887/5904/2341/files/1944-6K_1.jpg?v=1765387804',
  'southbend-1944-6ofer': 'https://cdn.shopify.com/s/files/1/0887/5904/2341/files/1944-6OFEK_1.jpg?v=1765387806',
  'southbend-1944-5ok': 'https://cdn.shopify.com/s/files/1/0887/5904/2341/files/1944-5OK.jpg?v=1765386966',
  'southbend-1944-6ok-hd': 'https://cdn.shopify.com/s/files/1/0887/5904/2341/files/1944-6OK-HD.jpg?v=1765386979',
  'southbend-1944-6ok': 'https://cdn.shopify.com/s/files/1/0887/5904/2341/files/1944-6OK.jpg?v=1765386982',
  'southbend-1944-6k': 'https://cdn.shopify.com/s/files/1/0887/5904/2341/files/1944-6K.jpg?v=1765386973',
  'southbend-1944-5ok-hd': 'https://cdn.shopify.com/s/files/1/0887/5904/2341/files/1944-5OK-HD.jpg?v=1765386963',
};

export function seedSouthBendImages() {
  const update = db.prepare(`
    UPDATE products SET image_url = @image_url
    WHERE id = @id AND brand = 'South Bend Clutch' AND (image_url IS NULL OR image_url = '')
  `);
  let updated = 0;
  for (const [id, image_url] of Object.entries(SOUTH_BEND_IMAGE_MAP)) {
    try {
      const info = update.run({ id, image_url });
      if (info.changes > 0) updated++;
    } catch (err) {
      console.error('[seedSouthBendImages] update failed for', id, '-', err.message);
    }
  }
  const total = Object.keys(SOUTH_BEND_IMAGE_MAP).length;
  console.log(`[seedSouthBendImages] set image_url on ${updated}/${total} South Bend Clutch rows this run (${SOUTH_BEND_PRODUCTS.length - total} remaining South Bend products have no confirmed photo yet).`);
}

// South Bend Clutch — generic fallback photos.
// For the South Bend clutch-kit and hydraulic-master-cylinder SKUs where no
// SKU-specific photo could be confidently verified on southbendclutch.com
// (either no image exists there yet, or the only match found was an
// unverified/likely-wrong image), Cody asked for a generic representative
// photo instead of leaving the tile blank. Both generic photos are real
// South Bend Clutch photos from their own site (not stock art): the clutch
// kit generic reuses the confirmed SDD3250-GK hero shot (a full Stage 3
// Cummins clutch kit), and the hydraulic generic reuses the confirmed
// HYD-HD hydraulic clutch master cylinder photo. Same safety pattern as
// every other seedXImages() function: only fills in image_url where still
// empty, so a real SKU-specific photo added later always takes priority
// and this never clobbers a manual edit made in Admin -> Products.
const SOUTH_BEND_GENERIC_CLUTCH_IMAGE = 'https://cdn.shopify.com/s/files/1/0887/5904/2341/files/SDD3250-GK.jpg?v=1765453272';
const SOUTH_BEND_GENERIC_HYDRAULIC_IMAGE = 'https://cdn.shopify.com/s/files/1/0887/5904/2341/files/HYD-HD.jpg?v=1765387321';

const SOUTH_BEND_GENERIC_CLUTCH_IDS = [
  'southbend-1947-okhd', 'southbend-1947-ok', 'southbend-sddmaxz-org', 'southbend-sdm506dfk',
  'southbend-1947-ohd', 'southbend-1939-df', 'southbend-sddmax-dfz', 'southbend-sfdd3250-6-4-org',
  'southbend-sfdd325060org', 'southbend-sfdd3250-6-4', 'southbend-1947-ofe', 'southbend-1939ohd',
  'southbend-1947-o', 'southbend-sfdd3250-6-org', 'southbend-sfdd3250-6-0', 'southbend-1944-5or-hd',
  'southbend-1939-cb', 'southbend-1947-or-hd', 'southbend-1947-ofer', 'southbend-1944-5or',
  'southbend-1944-5ofer', 'southbend-sdm0506ok', 'southbend-1947-ofek', 'southbend-sddmax-dfy',
  'southbend-sddmaxy-org', 'southbend-sfdd3250-6', 'southbend-0090',
];
const SOUTH_BEND_GENERIC_HYDRAULIC_IDS = [
  'southbend-hydx-750', 'southbend-hydx1-50', 'southbend-hydx-f6-0-6-4', 'southbend-hydx-f67-3',
];

export function seedSouthBendGenericImages() {
  const update = db.prepare(`
    UPDATE products SET image_url = @image_url
    WHERE id = @id AND brand = 'South Bend Clutch' AND (image_url IS NULL OR image_url = '')
  `);
  let updated = 0;
  for (const id of SOUTH_BEND_GENERIC_CLUTCH_IDS) {
    try {
      const info = update.run({ id, image_url: SOUTH_BEND_GENERIC_CLUTCH_IMAGE });
      if (info.changes > 0) updated++;
    } catch (err) {
      console.error('[seedSouthBendGenericImages] clutch fallback failed for', id, '-', err.message);
    }
  }
  for (const id of SOUTH_BEND_GENERIC_HYDRAULIC_IDS) {
    try {
      const info = update.run({ id, image_url: SOUTH_BEND_GENERIC_HYDRAULIC_IMAGE });
      if (info.changes > 0) updated++;
    } catch (err) {
      console.error('[seedSouthBendGenericImages] hydraulic fallback failed for', id, '-', err.message);
    }
  }
  const total = SOUTH_BEND_GENERIC_CLUTCH_IDS.length + SOUTH_BEND_GENERIC_HYDRAULIC_IDS.length;
  console.log(`[seedSouthBendGenericImages] set generic image_url on ${updated}/${total} South Bend Clutch rows this run.`);
}

migrate();
seedFassProducts();
seedDccTurbos();
seedP1rp();
seedP1rpImages();
seedNoLimitProducts();
seedNoLimitImages();
seedSouthBendProducts();
seedSouthBendImages();
seedSouthBendGenericImages();

if (process.argv.includes('--migrate')) {
  console.log('Migration applied to', DB_PATH);
}
