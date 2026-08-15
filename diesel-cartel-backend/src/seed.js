// ============================================================
// Seed script — ports the placeholder catalog that currently lives
// in the static front-end (diesel-site/assets/js/data.js) into the
// real SQLite database, so the API has something to serve on day
// one. This is a BRIDGE, not the long-term source of truth: once
// real supplier data (Dix Performance, APG Wholesale, Meyers,
// Suntop Hi-Tech) is available, replace these rows via the admin
// API rather than re-running this script over real inventory.
//
// Run with: npm run seed
// Safe to re-run — uses INSERT OR REPLACE, so it won't duplicate rows.
// ============================================================
import { db, migrate } from './db.js';

migrate();

const CATEGORIES = [
  { slug: 'tuning', name: 'Tuning & Programmers', icon: 'ecu', blurb: 'ECU tuners, programmers & monitors' },
  { slug: 'exhaust', name: 'Exhaust Systems', icon: 'exhaust', blurb: 'Downpipes, turbo-back & cat-back kits' },
  { slug: 'turbochargers', name: 'Turbochargers', icon: 'turbo', blurb: 'Drop-in & compound turbo kits' },
  { slug: 'suspension', name: 'Suspension & Lift', icon: 'lift', blurb: 'Lift kits, leveling kits & shocks' },
  { slug: 'wheels', name: 'Wheels & Tires', icon: 'wheel', blurb: 'Forged & cast wheels for dually and 4x4' },
  { slug: 'intake', name: 'Intake Systems', icon: 'intake', blurb: 'Cold air intakes & filters' },
  { slug: 'fuel', name: 'Fuel Systems', icon: 'injector', blurb: 'Injectors, lift pumps & CP3s' },
  { slug: 'apparel', name: 'Apparel & Gear', icon: 'apparel', blurb: 'Shop-branded hoodies, tees & hats' },
];

const PLATFORMS = [
  { slug: 'cummins', name: 'Cummins', sub: 'Dodge / Ram', years: '1989–2026' },
  { slug: 'duramax', name: 'Duramax', sub: 'GM / Chevrolet', years: '2001–2026' },
  { slug: 'powerstroke', name: 'Power Stroke', sub: 'Ford', years: '1994–2026' },
];

function pid(n) { return 'BD-' + String(n).padStart(4, '0'); }

// price is in whole dollars here for readability; converted to cents below.
const PRODUCTS = [
  { id: pid(101), sku: 'BD-0101', name: 'Blackline Stage 2 Handheld Programmer', brand: 'Blackline Tuning', category: 'tuning', platform: 'cummins', price: 649, compareAt: 729, badge: 'sale', icon: 'ecu', rating: 4.8, reviews: 214, stock: 24,
    desc: 'Plug-and-play handheld tuner with pre-loaded Stage 1–3 power levels, real-time gauge monitoring, and DPF/DEF delete-friendly tuning for off-road use.',
    features: ['5 custom tune slots + stock recovery', 'Live EGT, boost & trans temp gauges', 'Adjustable speedo, tire size & shift points', 'Free tune revisions for 1 year'] },
  { id: pid(102), sku: 'BD-0102', name: 'Redline EFI-Live AutoCal Tuner', brand: 'Redline Turbo Co', category: 'tuning', platform: 'duramax', price: 799, badge: 'best', icon: 'ecu', rating: 4.9, reviews: 341, stock: 18,
    desc: 'The industry-standard autocal solution for full custom tuning access, built for shops and serious DIY tuners running compound turbo setups.',
    features: ['Full read/write ECM & TCM access', 'Compatible with custom shop tune files', 'Built-in datalogging', 'Supports allison trans tuning'] },
  { id: pid(103), sku: 'BD-0103', name: 'Apex CTS3 Color Touchscreen Monitor', brand: 'Apex Fuel Systems', category: 'tuning', platform: 'powerstroke', price: 589, icon: 'gauge', rating: 4.6, reviews: 128, stock: 30,
    desc: '5" full-color touchscreen tuner and gauge display with support for up to 3 custom tune files and 10 configurable gauge pages.',
    features: ['5" high-resolution touchscreen', '3 custom tune slots', 'GPS speedometer correction', 'In-cab DPF regen control'] },
  { id: pid(104), sku: 'BD-0104', name: 'Ironclad Race Tuner Cable Kit', brand: 'Ironclad Diesel', category: 'tuning', platform: 'cummins', price: 219, icon: 'ecu', rating: 4.4, reviews: 76, stock: 40,
    desc: 'USB tuning cable and software bundle for loading custom race files directly to the ECM. Dyno-proven files included for common mod combos.',
    features: ['USB-C tuning cable', '6 dyno-proven race files included', 'Windows & Mac compatible software', 'Email support from staff tuners'] },
  { id: pid(105), sku: 'BD-0105', name: 'Blackline Stage 1 Value Tuner', brand: 'Blackline Tuning', category: 'tuning', platform: 'duramax', price: 429, badge: 'new', icon: 'ecu', rating: 4.7, reviews: 52, stock: 22,
    desc: 'Budget-friendly entry point into tuning — safe daily-driver power and towing gains without touching factory emissions equipment.',
    features: ['Tow & economy tune modes', 'Emissions-compliant Stage 1 power', 'Simple 10-minute install', '2-year warranty'] },

  { id: pid(201), sku: 'BD-0201', name: 'Growler 5" Turbo-Back Exhaust Kit', brand: 'Growler Exhaust', category: 'exhaust', platform: 'cummins', price: 899, badge: 'best', icon: 'exhaust', rating: 4.9, reviews: 302, stock: 15,
    desc: 'Mandrel-bent 5" aluminized steel turbo-back system with a straight-through muffler for maximum flow and an aggressive diesel rumble.',
    features: ['Aluminized steel construction', 'Mandrel-bent for max flow', 'Bolt-on install, no cutting required', 'Available with or without muffler'] },
  { id: pid(202), sku: 'BD-0202', name: 'Growler 4" Cat-Back Stainless System', brand: 'Growler Exhaust', category: 'exhaust', platform: 'duramax', price: 749, icon: 'exhaust', rating: 4.7, reviews: 165, stock: 20,
    desc: 'T304 stainless cat-back exhaust with a deep, mellow tone. Polished tip included for a finished, aggressive stance.',
    features: ['T304 stainless steel', 'Polished 5" rolled tip', 'Lifetime warranty against rust', '50-state street legal'] },
  { id: pid(203), sku: 'BD-0203', name: 'Ironclad DPF-Back Muffler Delete Pipe', brand: 'Ironclad Diesel', category: 'exhaust', platform: 'powerstroke', price: 289, icon: 'exhaust', rating: 4.5, reviews: 98, stock: 35,
    desc: 'Off-road use exhaust pipe that routes past the muffler for weight savings and increased exhaust flow on race-prepped trucks.',
    features: ['16-gauge aluminized steel', 'Direct bolt-on flanges', 'Off-road / competition use only', 'Ships in 2 business days'] },
  { id: pid(204), sku: 'BD-0204', name: 'Torque Forge Bolt-On Exhaust Tips (Pair)', brand: 'Torque Forge', category: 'exhaust', platform: 'cummins', price: 149, badge: 'new', icon: 'exhaust', rating: 4.6, reviews: 61, stock: 50,
    desc: 'Stacked dual exhaust tips machined from solid stainless bar stock with a black-chrome finish. Universal clamp-on fit.',
    features: ['Solid stainless bar stock', 'Black-chrome finish', 'Fits 4"–5" outlet pipes', 'Universal clamp-on install'] },
  { id: pid(205), sku: 'BD-0205', name: 'Growler Compound Turbo Race Downpipe', brand: 'Growler Exhaust', category: 'exhaust', platform: 'duramax', price: 459, icon: 'exhaust', rating: 4.8, reviews: 87, stock: 12,
    desc: 'Heavy-wall race downpipe engineered for compound turbo setups, eliminating restriction between the turbos and the rest of the system.',
    features: ['Schedule 10 stainless', 'V-band connections', 'Compound-turbo specific geometry', 'Made in-house, ships in 3–5 days'] },

  { id: pid(301), sku: 'BD-0301', name: 'Redline S400 Drop-In Turbocharger', brand: 'Redline Turbo Co', category: 'turbochargers', platform: 'cummins', price: 1899, badge: 'best', icon: 'turbo', rating: 4.9, reviews: 176, stock: 8,
    desc: 'Billet-wheel drop-in replacement turbo rated for 700+ RWHP, engineered for tow-friendly spool with race-day top-end.',
    features: ['Billet compressor wheel', 'Ball-bearing center cartridge', 'Rated to 700+ RWHP', 'Drop-in, no fabrication required'] },
  { id: pid(302), sku: 'BD-0302', name: 'Redline Stock-Replacement Turbocharger', brand: 'Redline Turbo Co', category: 'turbochargers', platform: 'duramax', price: 1199, icon: 'turbo', rating: 4.7, reviews: 143, stock: 14,
    desc: 'OEM-spec remanufactured turbo built to factory tolerances for a reliable, budget-conscious replacement.',
    features: ['Remanufactured to OEM spec', 'New actuator included', 'Balanced & flow-tested', '2-year unlimited mile warranty'] },
  { id: pid(303), sku: 'BD-0303', name: 'Redline Compound Turbo Kit — Stage 2', brand: 'Redline Turbo Co', category: 'turbochargers', platform: 'powerstroke', price: 3299, icon: 'turbo', rating: 4.9, reviews: 54, stock: 5,
    desc: 'Complete compound turbo system with charge piping, oil lines, and a billet high-pressure turbo for 900+ RWHP builds.',
    features: ['High-pressure billet turbo', 'Low-pressure atmosphere turbo', 'Full stainless charge piping kit', 'Includes oil feed & drain lines'] },
  { id: pid(304), sku: 'BD-0304', name: 'Nitro Diesel Variable Geometry Actuator', brand: 'Nitro Diesel Dynamics', category: 'turbochargers', platform: 'cummins', price: 249, icon: 'turbo', rating: 4.4, reviews: 39, stock: 26,
    desc: 'Direct-fit VGT actuator replacement to resolve limp mode and boost fluctuation caused by a worn factory unit.',
    features: ['Direct OEM-fit replacement', 'Pre-calibrated, no programming needed', 'Includes install hardware', '1-year warranty'] },

  { id: pid(401), sku: 'BD-0401', name: 'Overland 6" Radius Arm Lift Kit', brand: 'Overland Suspension', category: 'suspension', platform: 'powerstroke', price: 2199, badge: 'best', icon: 'lift', rating: 4.8, reviews: 121, stock: 9,
    desc: 'Complete 6" front/rear lift system with forged radius arms, remote-reservoir shocks, and room for 37" tires.',
    features: ['Forged radius arms', 'Remote-reservoir monotube shocks', 'Fits up to 37" tires', 'Includes track bar & sway bar links'] },
  { id: pid(402), sku: 'BD-0402', name: 'Overland 2.5" Leveling Kit', brand: 'Overland Suspension', category: 'suspension', platform: 'duramax', price: 389, icon: 'lift', rating: 4.6, reviews: 210, stock: 33,
    desc: 'Bolt-on strut spacer leveling kit that corrects factory front rake for a level stance with larger tires.',
    features: ['Billet aluminum spacers', 'No coil spring removal needed', '2–3 hour install', 'Lifetime structural warranty'] },
  { id: pid(403), sku: 'BD-0403', name: 'Cinderblock Traction Bar Kit', brand: 'Cinderblock Fab', category: 'suspension', platform: 'cummins', price: 549, icon: 'lift', rating: 4.7, reviews: 88, stock: 17,
    desc: 'Heavy-duty traction bars that eliminate axle wrap under hard acceleration and towing, built from 2" DOM tubing.',
    features: ['2" DOM tubing construction', 'Greaseable Heim joints', 'Adjustable pinion angle', 'Powder-coated black finish'] },
  { id: pid(404), sku: 'BD-0404', name: 'Overland Remote-Reservoir Shock Set', brand: 'Overland Suspension', category: 'suspension', platform: 'powerstroke', price: 899, icon: 'lift', rating: 4.8, reviews: 66, stock: 11,
    desc: 'Adjustable remote-reservoir shocks for lifted trucks running aggressive off-road duty cycles.',
    features: ['External reservoir, 40-click adjustable', 'Vehicle-specific valving', 'Set of 4 (front & rear)', 'Rebuildable design'] },

  { id: pid(501), sku: 'BD-0501', name: 'Ridgeback Dually Forged Wheel Set', brand: 'Ridgeback Wheels', category: 'wheels', platform: 'cummins', price: 3199, badge: 'new', icon: 'wheel', rating: 4.9, reviews: 44, stock: 4,
    desc: 'Forged aluminum dually wheel set with a deep concave face, rated for heavy tow and haul duty.',
    features: ['6061-T6 forged aluminum', 'Set of 6 (4 rear duals + 2 front)', '10,000 lb load rating per wheel', 'Matte black finish'] },
  { id: pid(502), sku: 'BD-0502', name: 'Ridgeback 20" Off-Road Wheel Set', brand: 'Ridgeback Wheels', category: 'wheels', platform: 'duramax', price: 1599, icon: 'wheel', rating: 4.7, reviews: 132, stock: 10,
    desc: 'Cast aluminum 20" wheel set built for 35"+ tires with an aggressive 8-spoke off-road design.',
    features: ['Cast aluminum construction', 'Set of 4', 'Fits up to 37" tires', 'Satin black finish'] },
  { id: pid(503), sku: 'BD-0503', name: 'Ridgeback Beadlock-Style 17" Wheels', brand: 'Ridgeback Wheels', category: 'wheels', platform: 'powerstroke', price: 1899, icon: 'wheel', rating: 4.6, reviews: 58, stock: 13,
    desc: 'Beadlock-style simulated ring wheels for a race-truck look without the maintenance of true beadlocks.',
    features: ['Simulated beadlock ring', 'Set of 4', '17x9, -12mm offset', 'Gloss black w/ machined ring'] },
  { id: pid(504), sku: 'BD-0504', name: 'Ridgeback All-Terrain Tire — 35x12.5R20', brand: 'Ridgeback Wheels', category: 'wheels', platform: 'cummins', price: 349, icon: 'wheel', rating: 4.5, reviews: 201, stock: 60,
    desc: 'Aggressive all-terrain tire with reinforced sidewalls built to handle heavy diesel truck weight on and off pavement.',
    features: ['3-ply sidewall construction', 'Sold individually', '65,000 mile tread warranty', 'Aggressive mud-shedding tread'] },

  { id: pid(601), sku: 'BD-0601', name: 'Hammerhead Cold Air Intake System', brand: 'Hammerhead Performance', category: 'intake', platform: 'duramax', price: 349, badge: 'best', icon: 'intake', rating: 4.8, reviews: 264, stock: 28,
    desc: 'High-flow cold air intake with a reusable oiled filter, lowering intake temps for consistent power gains.',
    features: ['Reusable oiled air filter', 'Powder-coated aluminum tube', '50-state legal', 'Bolt-on, no tuning required'] },
  { id: pid(602), sku: 'BD-0602', name: 'Hammerhead Dry-Filter Intake Kit', brand: 'Hammerhead Performance', category: 'intake', platform: 'powerstroke', price: 329, icon: 'intake', rating: 4.6, reviews: 118, stock: 24,
    desc: 'Dry-media filter intake for owners who prefer to avoid oiled filters near MAF sensors, with the same flow gains.',
    features: ['Dry synthetic media filter', 'Sealed airbox design', 'Reduces intake air temps', 'Simple hand-tool install'] },
  { id: pid(603), sku: 'BD-0603', name: 'Hammerhead Turbo Inlet Horn', brand: 'Hammerhead Performance', category: 'intake', platform: 'cummins', price: 129, icon: 'intake', rating: 4.4, reviews: 45, stock: 45,
    desc: 'Cast aluminum turbo inlet horn that smooths airflow into the compressor housing for a slight spool improvement.',
    features: ['Cast aluminum construction', 'Direct bolt-on fit', 'Smooths turbulent airflow', 'Includes new gasket & hardware'] },

  { id: pid(701), sku: 'BD-0701', name: 'Apex Stage 2 Injector Set (6)', brand: 'Apex Fuel Systems', category: 'fuel', platform: 'cummins', price: 1499, badge: 'sale', compareAt: 1699, icon: 'injector', rating: 4.8, reviews: 92, stock: 10,
    desc: 'Reman injector set with 20% over-fueling for Stage 2 power builds, flow-tested and balanced as a matched set.',
    features: ['Set of 6, flow-matched', '20% over stock fueling', 'Core exchange available', '1-year warranty'] },
  { id: pid(702), sku: 'BD-0702', name: 'Apex Adjustable Fuel Lift Pump Kit', brand: 'Apex Fuel Systems', category: 'fuel', platform: 'duramax', price: 419, icon: 'fuel', rating: 4.7, reviews: 156, stock: 22,
    desc: 'Frame-mounted lift pump kit with adjustable pressure to keep the factory CP3 fed under high-demand tuning.',
    features: ['Frame-mounted design', 'Adjustable output pressure', 'Includes fuel filter & bracket', 'Universal wiring harness'] },
  { id: pid(703), sku: 'BD-0703', name: 'Apex Heavy-Duty Fuel Filtration Kit', brand: 'Apex Fuel Systems', category: 'fuel', platform: 'powerstroke', price: 259, icon: 'fuel', rating: 4.6, reviews: 74, stock: 31,
    desc: 'Dual-stage fuel filtration upgrade with a water-separating first stage to protect injectors and the high-pressure pump.',
    features: ['Dual-stage filtration', 'Water-in-fuel sensor compatible', 'Bolt-on frame mount', 'Filters sold separately for changes'] },
  { id: pid(704), sku: 'BD-0704', name: 'Apex CP3 High-Output Fuel Pump', brand: 'Apex Fuel Systems', category: 'fuel', platform: 'cummins', price: 899, icon: 'fuel', rating: 4.9, reviews: 61, stock: 9,
    desc: 'Ported and upgraded CP3 high-pressure pump for injector sets exceeding stock fueling demand.',
    features: ['Ported for +30% flow', 'New internals, not just ported housing', 'Core exchange available', 'Dyno-tested before shipping'] },

  { id: pid(801), sku: 'BD-0801', name: 'Diesel Cartel Shop Hoodie', brand: 'Diesel Cartel Canada', category: 'apparel', platform: 'universal', price: 69, icon: 'apparel', rating: 4.9, reviews: 412, stock: 80,
    desc: 'Heavyweight fleece hoodie with embroidered chest logo and full back print. True to size, unisex fit.',
    features: ['Heavyweight 320gsm fleece', 'Embroidered chest logo', 'Full back screen print', 'Sizes S–4XL'] },
  { id: pid(802), sku: 'BD-0802', name: 'Diesel Cartel Trucker Cap', brand: 'Diesel Cartel Canada', category: 'apparel', platform: 'universal', price: 32, badge: 'new', icon: 'apparel', rating: 4.7, reviews: 188, stock: 120,
    desc: 'Structured five-panel trucker cap with a mesh back and embroidered logo patch. Adjustable snapback closure.',
    features: ['Structured 5-panel design', 'Mesh back panels', 'Embroidered logo patch', 'Adjustable snapback'] },
  { id: pid(803), sku: 'BD-0803', name: 'Diesel Cartel Work Tee', brand: 'Diesel Cartel Canada', category: 'apparel', platform: 'universal', price: 29, icon: 'apparel', rating: 4.6, reviews: 267, stock: 150,
    desc: '100% cotton work tee built for the shop floor, with reinforced stitching and a screen-printed back graphic.',
    features: ['100% heavyweight cotton', 'Reinforced double-stitched seams', 'Screen-printed back graphic', 'Sizes S–3XL'] },
  { id: pid(804), sku: 'BD-0804', name: 'Diesel Cartel Decal Pack (5)', brand: 'Diesel Cartel Canada', category: 'apparel', platform: 'universal', price: 15, icon: 'apparel', rating: 4.8, reviews: 501, stock: 200,
    desc: 'Set of 5 die-cut vinyl decals in assorted sizes, weatherproof for years of highway miles.',
    features: ['Die-cut vinyl, 5 pieces', 'UV & weatherproof', 'Sizes from 3" to 8"', 'Indoor or outdoor use'] },
];

const insertCategory = db.prepare(`
  INSERT INTO categories (slug, name, blurb, icon) VALUES (@slug, @name, @blurb, @icon)
  ON CONFLICT(slug) DO UPDATE SET name = excluded.name, blurb = excluded.blurb, icon = excluded.icon
`);
for (const c of CATEGORIES) insertCategory.run(c);

const insertPlatform = db.prepare(`
  INSERT INTO platforms (slug, name, sub, years) VALUES (@slug, @name, @sub, @years)
  ON CONFLICT(slug) DO UPDATE SET name = excluded.name, sub = excluded.sub, years = excluded.years
`);
for (const p of PLATFORMS) insertPlatform.run(p);

const insertProduct = db.prepare(`
  INSERT INTO products (id, sku, name, brand, category_slug, platform_slug, price_cents, compare_at_cents,
    badge, icon, rating, reviews, description, features_json, image_url, active, stock_qty)
  VALUES (@id, @sku, @name, @brand, @categorySlug, @platformSlug, @priceCents, @compareAtCents,
    @badge, @icon, @rating, @reviews, @description, @featuresJson, @imageUrl, 1, @stockQty)
  ON CONFLICT(id) DO UPDATE SET
    sku = excluded.sku, name = excluded.name, brand = excluded.brand, category_slug = excluded.category_slug,
    platform_slug = excluded.platform_slug, price_cents = excluded.price_cents, compare_at_cents = excluded.compare_at_cents,
    badge = excluded.badge, icon = excluded.icon, rating = excluded.rating, reviews = excluded.reviews,
    description = excluded.description, features_json = excluded.features_json, image_url = excluded.image_url,
    updated_at = datetime('now')
`);

for (const p of PRODUCTS) {
  insertProduct.run({
    id: p.id,
    sku: p.sku,
    name: p.name,
    brand: p.brand,
    categorySlug: p.category,
    platformSlug: p.platform,
    priceCents: Math.round(p.price * 100),
    compareAtCents: p.compareAt ? Math.round(p.compareAt * 100) : null,
    badge: p.badge || null,
    icon: p.icon || null,
    rating: p.rating,
    reviews: p.reviews,
    description: p.desc,
    featuresJson: JSON.stringify(p.features || []),
    imageUrl: null, // real product photos come later — see README "Images" section
    stockQty: p.stock,
  });
}

console.log(`Seeded ${CATEGORIES.length} categories, ${PLATFORMS.length} platforms, ${PRODUCTS.length} products.`);
