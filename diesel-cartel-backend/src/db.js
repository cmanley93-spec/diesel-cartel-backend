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
  for (const p of DCC_TURBO_PRODUCTS) insert.run(p);

  const updateName = db.prepare(`UPDATE products SET name = @name WHERE id = @id AND brand = 'DCC'`);
  for (const p of DCC_TURBO_PRODUCTS) {
    updateName.run({ id: p.id, name: p.name });
  }
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

if (process.argv.includes('--migrate')) {
  console.log('Migration applied to', DB_PATH);
}
