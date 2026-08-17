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

migrate();
seedFassProducts();
seedDccTurbos();
seedP1rp();

if (process.argv.includes('--migrate')) {
  console.log('Migration applied to', DB_PATH);
}
