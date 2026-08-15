# Diesel Cartel Canada — Backend API

A small, real, working store backend: product catalog, Stripe Checkout, order
tracking, and a basic admin API. Pairs with the static storefront in
`../diesel-site`.

## Why zero npm dependencies

This was built with **no external packages at all** — `package.json` has no
`dependencies`. That wasn't the original plan (Express + Postgres + the
Stripe SDK was); it's what I landed on after the environment I built it in
had its npm registry access blocked, so `npm install` failed for everything,
including Express itself.

Rather than block on that, I rebuilt the plan around what Node ships with
out of the box:

- **`node:http`** instead of Express — a small hand-rolled router (see
  `src/server.js`) matches method + path patterns like `/api/products/:id`.
- **`node:sqlite`** instead of `pg`/Prisma — a real embedded SQL database,
  file-based, zero setup. It's marked "experimental" in Node but the API
  surface used here (`DatabaseSync`, prepared statements, named params) is
  stable enough for this. It ships in Node 22.5+.
- **Built-in `fetch`** instead of the `stripe` npm package — Stripe's API is
  plain HTTPS + bearer auth, so `src/lib/stripe.js` calls it directly. It
  re-implements the two fiddly bits by hand: Stripe's bracket-notation form
  encoding for nested params, and webhook signature verification
  (HMAC-SHA256, constant-time compare, replay-window check).
- **`node --env-file=.env`** instead of the `dotenv` package — a Node 22
  built-in flag.

**What this means for you:** it runs anywhere with Node 22.5+ and nothing
else — no `npm install` step, no lockfile drift, no supply-chain surface
from a dependency tree. The tradeoff is that it's a less "standard" stack
than a Node dev would expect by default (no Express, no ORM), so if you ever
hand this to another developer, this section is the heads-up. Nothing here
is locked in: swapping `node:sqlite` for Postgres later, or wrapping the
router in Express, is a contained change — the SQL is plain enough to port,
and the route handlers don't know or care what's calling them.

## Setup

Requires **Node 22.5 or newer** (`node --version` to check).

```bash
cd diesel-cartel-backend
cp .env.example .env
# edit .env — at minimum set STRIPE_SECRET_KEY and ADMIN_TOKEN
npm run migrate   # creates data/store.db and the schema
npm run seed       # loads the 33-product placeholder catalog
npm start           # starts the API on http://localhost:4000
```

`npm run dev` runs the same thing with `--watch` (auto-restart on file
changes) — use that while iterating.

## What's real here vs. what's still placeholder

**Real and working:**
- Product catalog lives in an actual SQLite database, not a hardcoded JS file.
- Checkout creates a real Stripe Checkout Session and redirects to Stripe's
  hosted payment page — Stripe (not this code) handles card entry, 3DS, etc.
- Every price is looked up and re-totaled **server-side** from the database
  at checkout time. The client can only say which product IDs and
  quantities it wants; it never gets to say what anything costs. This is
  the one rule in this codebase that must never be relaxed (see the comment
  block at the top of `src/routes/checkout.js`).
- Stripe webhooks are signature-verified before anything acts on them, and
  order completion is idempotent (a duplicate `checkout.session.completed`
  event won't double-decrement stock) — verified by hand in this session by
  sending a real signed payload through the running server and checking the
  DB before/after, including sending it twice.
- Stock quantities decrement on paid orders and are checked (and rejected
  with a 409) if someone tries to buy more than is in stock.
- The storefront (`../diesel-site`) is wired to this API end to end —
  catalog, cart, checkout redirect, and order confirmation. Verified in a
  headless browser: the homepage renders real categories/platforms/products
  fetched live from `/api/*`, and the checkout page's order summary matches
  the server-computed totals exactly for a real cart.

**Still placeholder — same 33 fictional products from the old static site:**
- No real supplier data yet from Dix Performance, APG Wholesale, Meyers, or
  Suntop Hi-Tech — the seed script ports the same demo catalog the static
  site had, as a bridge so the API isn't empty. Swap this out via the admin
  API (or a new seed run) once real product/pricing data is available.
- No product images — `image_url` is `null` for every seeded product. See
  "Images" below.
- Tax is a flat 12% in `src/routes/checkout.js` — fine for one province as a
  placeholder, not correct for a real multi-province Canadian store. Same
  file has flat-rate shipping ($24.99, free over $150) — also worth revisiting.
- Admin auth is a single shared bearer token, not per-user accounts (the
  `admin_users` table exists in the schema for when you want that upgrade).

## API reference

All responses are JSON. Prices in response bodies are in dollars (decimal);
internally everything is stored and computed in cents to avoid float issues.

**Public:**
- `GET /api/health`
- `GET /api/categories`
- `GET /api/platforms`
- `GET /api/products?category=&platform=&q=&minPrice=&maxPrice=&sort=`
  — `sort` is one of `featured` (default), `price-asc`, `price-desc`,
  `rating`, `name`
- `GET /api/products/:id`
- `POST /api/checkout/session` — body: `{ items: [{productId, qty}],
  customerEmail?, origin? }`. `origin` is the storefront base URL used to
  build Stripe's redirect URLs; falls back to `STOREFRONT_URL` if omitted.
  Returns `{ orderId, checkoutUrl, sessionId }` — redirect the browser to
  `checkoutUrl`.
- `GET /api/orders/by-session/:sessionId` — for the confirmation page to
  look up what was ordered after a successful Stripe redirect.
- `POST /api/webhooks/stripe` — Stripe calls this, you don't. Point your
  Stripe webhook endpoint here.

**Admin** (require header `Authorization: Bearer <ADMIN_TOKEN>`):
- `GET /api/admin/orders` — last 200 orders.
- `POST /api/admin/products` — create a product.
- `PATCH /api/admin/products/:id` — update any subset of fields (price,
  stock, description, active flag, etc.).
- `DELETE /api/admin/products/:id` — soft-delete (sets `active = 0`;
  doesn't actually remove the row, so past orders referencing it stay intact).

## Connecting the storefront

Done — the front-end (`../diesel-site`) now loads its catalog live from this
API (`assets/js/api.js`, gated behind a `DATA_READY` promise every page
awaits before rendering) instead of a static `data.js` file, and its
checkout page POSTs to `/api/checkout/session` and redirects the browser to
the real Stripe-hosted `checkoutUrl`. The confirmation page looks the
finished order up via `/api/orders/by-session/:sessionId`. The old "demo
site, not a real business" banners are gone.

The one thing left to point at the real backend: `diesel-site/assets/js/config.js`
sets `window.API_BASE_URL`, currently `http://localhost:4000` for local dev.
Once this backend is deployed, update that one line to the live backend URL
(and set this backend's `CORS_ORIGINS` env var to the storefront's deployed
origin, or `*` for a quick private preview).

## Images

No product photos exist yet. Three realistic paths once you have supplier
image access:
1. Ask your reps at Dix Performance / APG Wholesale / Meyers / Suntop
   Hi-Tech for an official dealer image feed or spec-sheet export — this is
   the normal way dealers get manufacturer photos, and it's the most
   reliable path.
2. Export/download images yourself from a supplier's dealer portal (I can't
   log into any site on your behalf — see the security note below) and
   hand me the files or a folder; I can batch-resize/optimize and wire them
   into the database's `image_url` field.
3. For your own apparel line, product photos are the one category you could
   shoot yourself relatively easily.

## Deployment

This needs somewhere to actually run — right now it only runs in this
sandbox. Options once you're ready: any host that runs Node 22+ with
persistent disk (Railway, Render, Fly.io, a small VPS) works as-is with
SQLite. If you'd rather not manage a VPS, or want to scale past one
instance, swapping `node:sqlite` for a hosted Postgres is a contained
change (the SQL in `src/db.js` and the route handlers is plain enough to
port). I don't have a hosting connector active in this session — happy to
prep the code (Dockerfile, deploy config) for whichever target you pick.

## Security note

I won't ever enter passwords, API keys, or other login credentials into any
site or form on your behalf, even if you provide them and ask me to — this
is a hard rule with no exceptions. If a task needs your Stripe *secret* key
(server-side, goes in `.env`, never sent to the browser) that's fine for you
to paste into `.env` yourself. Your Stripe *publishable* key, if the
front-end ever needs one directly, is safe to expose client-side by design.
