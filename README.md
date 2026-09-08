# Cakely

Cakely is a Sri Lankan homemade cake store: a React/Vite storefront backed by
a Node.js API (running as a single Netlify Function) and a Supabase Postgres
database, all deployable on free tiers.

## Stack

- **Frontend:** React + Vite, served as a static site by Netlify
- **Backend:** Express app running inside one Netlify Function (`netlify/functions/api.js`)
- **Database + file storage:** Supabase Postgres for products and product images; Supabase Storage for custom-cake uploads
- **Hosting:** Netlify (frontend and backend both, on the same domain)

This replaces the earlier Flask/SQLAlchemy backend — Netlify Functions don't
support Python natively (JS, TS, and Go only), so the backend logic was
ported to Node while keeping the exact same `/api/...` routes and behavior.
The RuleLock AI integration point is preserved as-is: disabled by default,
lives in `netlify/functions/lib/rulelockService.js`, and can be switched on
later with `RULELOCK_ENABLED=true` without touching anything else.

## One-time Supabase setup

1. **Run the schema.** In your Supabase project dashboard: **SQL Editor →
   New query**, paste the contents of `supabase/schema.sql`, and run it.
   This creates all the tables and locks them down with Row Level Security
   (only your backend's secret key can read/write — nothing is publicly
   accessible).
2. **Create two storage buckets** (Storage → New bucket), both set to
   **Public**:
   - `product-images`
   - `custom-cakes`
3. **Get your keys.** Project Settings → Data API for the project URL,
   Project Settings → API Keys for the secret key (`sb_secret_...`).

## One-time seed (admin user + starter products + coupons)

```bash
cp .env.example .env
# fill in .env with your real SUPABASE_URL and SUPABASE_SECRET_KEY
npm install
npm run seed
```

This creates the admin login (`ADMIN_USERNAME` / `ADMIN_PASSWORD`, default
`admin` / `admin123`), nine starter products with placeholder images (swap
them for real photos from the admin panel after deploying), and the sample
coupon codes (`CAKE10`, `CAKE20`, `SAVE500`, etc.).

## Deploy to Netlify

1. Push this repo to GitHub.
2. In Netlify: **Add new site → Import an existing project**, pick the repo.
   Netlify will read `netlify.toml` automatically (build command, publish
   directory, and function directory are already configured — you don't
   need to change the defaults it suggests).
3. Before the first deploy, go to **Site configuration → Environment
   variables** and add:
   - `SUPABASE_URL`
   - `SUPABASE_SECRET_KEY`
   - `SUPABASE_PRODUCT_BUCKET` = `product-images`
   - `SUPABASE_CUSTOM_CAKE_BUCKET` = `custom-cakes`
   - `JWT_SECRET_KEY` — any long random string
   - `ADMIN_USERNAME`, `ADMIN_PASSWORD`
   - `CAKELY_SECURITY_MODE` = `normal`
   - `RULELOCK_ENABLED` = `false`
   - `RULELOCK_FAIL_MODE` = `OPEN`
   - Leave `FRONTEND_URL` and `VITE_API_URL` blank — frontend and backend
     share the same Netlify domain, so no CORS setup is needed.
4. Deploy. Your site and its API both live at the same Netlify URL —
   `https://your-site.netlify.app` for the storefront,
   `https://your-site.netlify.app/api/...` for the API (Netlify rewrites
   that to the function automatically).

## Run locally

```bash
# frontend
cd frontend
npm install
npm run dev
```

For local API testing, install the Netlify CLI (`npm i -g netlify-cli`) and
run `netlify dev` from the repo root — it serves the frontend and emulates
the function together, reading env vars from your `.env`.

## Notes / limitations to know about

- **Product images are database-backed.** Admin product uploads are stored as
   validated data URLs in `products.image`, so storefront images do not depend
   on a public product-image bucket. Custom-cake uploads continue to use the
   public `custom-cakes` Storage bucket.
- **Rate limiting is per-instance, not global.** The login/register rate
  limiter (`netlify/functions/api.js`) is in-memory per warm function
  container, so it resets on cold starts and isn't shared across concurrent
  instances. Good enough for a coursework-scale demo; not a substitute for
  a real distributed rate limiter in production.
- **Admin bootstrap** runs once per cold start (not once ever) — matching
  the original Flask behavior of re-syncing the admin password from
  `ADMIN_PASSWORD` on every startup. If you change `ADMIN_PASSWORD` in
  Netlify's env vars, it takes effect the next time the function cold-starts.
- **Security mode:** keep `CAKELY_SECURITY_MODE=normal` in production.
  `research` mode intentionally disables coupon-stacking protection and
  exists only for demonstrating the vulnerability in a controlled way.
