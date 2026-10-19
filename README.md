# Bike View — Netlify

A personal bike directory, re-architected for Netlify. This is a port of the
original FastAPI + Jinja2 + SQLite + Pillow app (`../bike_view`), which cannot
run on Netlify as-is: Netlify serves static files and short-lived functions,
with no writable filesystem and no long-running Python server.

| Original | This repo |
|---|---|
| Jinja2 server-rendered pages | Static HTML shells in `public/`, rendered client-side from the JSON API |
| FastAPI routes (23 endpoints) | One Netlify Functions v2 catch-all (`netlify/functions/api.ts`) in TypeScript |
| SQLite (`data/bike_view.db`) | Netlify Database (managed Postgres) |
| Local `uploads/` + Pillow | Netlify Blobs + browser-side canvas processing |

The API keeps the original paths, request bodies, JSON shapes, status codes,
and `{"detail": "..."}` error envelope, so the front-end scripts behave the
same way they did against FastAPI.

## Prerequisites

- **Netlify account on a credit-based plan** — Netlify Database is not
  available on the legacy free/starter plans.
- Node.js **22.18+** (for native TypeScript execution in the migration script
  and the built-in `node:sqlite`).
- Netlify CLI (installed as a dev dependency; use `npx netlify` or
  `npm run dev`).
- Optional: the original repo with its SQLite database and `uploads/` folder,
  if you want to migrate existing data.

## Layout

```
public/                     static site (publish directory)
  index.html                home shell (cards rendered by render/home.js)
  bikes/new.html            create form
  bikes/detail.html         detail shell (rendered by render/detail.js)
  bikes/edit.html           edit form
  pills.html                pill catalog
  settings/data.html        export / import
  static/                   CSS, images, and all browser JS
netlify/
  edge-functions/auth.ts    HTTP Basic Auth gate for the whole site
  functions/api.ts          the only function: /api/* router
  lib/                      http, db, blob store, validation helpers
  routes/                   one module per original app/routes/*.py
  database/migrations/      schema (auto-applied on deploy)
scripts/migrate.ts          one-time SQLite + uploads → Postgres + Blobs
netlify.toml                publish dir, functions dir, pretty-URL rewrites
```

Helpers live outside `netlify/functions/` so Netlify does not treat every
helper module as a separate function.

## First-time setup

1. Install dependencies:

   ```sh
   npm install
   ```

2. Create or link a Netlify site. This repo declares `@netlify/database` as a
   dependency, so the build provisions the site's production database on the
   first deploy (your plan must include Netlify Database). Linking locally:

   ```sh
   npx netlify link
   ```

3. Run locally:

   ```sh
   npm run dev        # netlify dev, http://localhost:8888
   ```

   `netlify dev` serves `public/`, bundles the function, and starts a local
   PGlite-backed development database under `.netlify/db`, injecting its
   connection string into the function. Apply the schema to that local
   database with:

   ```sh
   npx netlify database migrations apply   # local development database
   ```

   Production and preview deploys apply `netlify/database/migrations/`
   automatically; there is no CLI command that applies them to production
   manually. Migrations are checksummed once applied — never edit an applied
   migration; add a new one instead.

   - Blobs use a sandboxed local store unless `NETLIFY_SITE_ID` /
     `NETLIFY_BLOBS_TOKEN` are present in `.env` (see below), in which case the
     SDK is pointed at the real store.
   - If `NETLIFY_DB_URL` is present in `.env` or the shell (the migration
     setup below adds it), it overrides the local database and `netlify dev`
     will talk to that URL instead. Comment it out for offline development.

## Access control (HTTP Basic Auth)

The whole site — static pages, `/api/*`, images, and direct function URLs — is
gated by a Netlify Edge Function
([netlify/edge-functions/auth.ts](netlify/edge-functions/auth.ts)) using the
browser's standard username/password prompt. Credentials are checked against a
SHA-256 hash, so the password itself is never stored or committed.

Set two environment variables:

- `SITE_AUTH_USER` — username (defaults to `admin` if unset).
- `SITE_PASSWORD_HASH` — the password's SHA-256, generated with:

  ```sh
  echo -n "your-password" | shasum -a 256
  ```

Locally, put both in `.env`; `netlify dev` loads it, so use a test password.
In production, set them in Netlify UI → Site configuration → Environment
variables **before the first deploy**. The gate fails closed: if
`SITE_PASSWORD_HASH` is missing or is not a 64-character hex hash, every
request returns `503` rather than serving the site unprotected.

The browser resends the cached credentials automatically on same-origin
`fetch` and `<img>` requests, so the front end needs no changes. There is no
logout — Basic Auth credentials are cached per origin until the browser is
restarted (or in a private window) — and it is a single shared credential, not
per-user accounts. Netlify serves the site over HTTPS, so credentials are
encrypted in transit.

## Deploy

Connect this repo to a Netlify site (Git-based deploy) or deploy with the CLI.
`netlify.toml` already sets:

- publish directory `public/`
- functions directory `netlify/functions/`, bundled with esbuild
- pretty-URL rewrites (`/pills`, `/settings/data`, `/bikes/new`,
  `/bikes/:id/edit`, `/bikes/:id`) — specific routes before `/bikes/:id`

No `/api/*` redirect is needed: the function declares
`export const config = { path: "/api/*" }`.

Inside Functions, the database connection is resolved from the site's Netlify
Database configuration and Blobs credentials are injected by the runtime. The
only environment variables to set in the Netlify UI are `SITE_AUTH_USER` and
`SITE_PASSWORD_HASH` for the Basic Auth gate described above.

## Migrating existing data

The original repo is only read, never modified. Do this after the site's
schema exists (deploy once, or apply migrations as above).

1. Create the local env file and fill in the three values:

   ```sh
   cp .env.example .env
   ```

   - `NETLIFY_DB_URL` — the **production** connection string. Either copy it
     from Netlify UI → Database → connection details, or after the first
     deploy:

     ```sh
     npx netlify database status --branch production --show-credentials --json
     ```

     `npx netlify database connect --json` is not what you want here — without
     a branch it resolves to the local development database.
   - `NETLIFY_SITE_ID` — Site configuration → General → Site ID.
   - `NETLIFY_BLOBS_TOKEN` — Data & Storage → Blobs → tokens.

   These are only for running the migration script from your machine. The auth
   variables from the section above can live in the same `.env`; they do not
   affect the migration. The file is gitignored; never commit real values.
   Functions do not read `.env` in production.

2. Run the migration:

   ```sh
   npm run migrate
   ```

   The script refuses to touch a target database that already has bikes or
   pills. To wipe and restore anyway:

   ```sh
   npm run migrate -- --force
   ```

   What it does:

   - reads `../bike_view/data/bike_view.db` read-only (override with
     `OLD_REPO`, `OLD_DB_PATH`, or `OLD_UPLOADS`);
   - restores pills, bikes, bike-pill links, maintenance records, and image
     rows in one transaction — bikes and pills keep their ids, so
     `/bikes/<id>` links continue to work;
   - inserts with `OVERRIDING SYSTEM VALUE`, then resets both identity
     sequences (`setval`) so the next created bike/pill cannot collide;
   - uploads each referenced photo and thumbnail from `uploads/bikes/<id>/`
     to Blobs under `bikes/<id>/<filename>`; missing files are reported and
     the row is kept (the UI falls back to the placeholder);
   - reports files on disk that no image row references (e.g. the old seed
     photos) and skips them.

3. Verify: open the deployed home page, check each bike, and download
   `/api/export` to confirm counts and ids.

The migration is intentionally one-shot: re-running without `--force` is a
no-op guard, and `--force` replaces all current data.

## API

All routes are served by `netlify/functions/api.ts`.

| Method | Path | Notes |
|---|---|---|
| GET | `/api/bikes` | optional `?status=active\|former`; cards include pills + `primary_image`/`primary_thumb` |
| POST | `/api/bikes` | 201 |
| GET | `/api/bikes/:id` | includes `images` with `url` / `thumb_url` |
| PATCH | `/api/bikes/:id` | partial update; `{}` is a no-op |
| DELETE | `/api/bikes/:id` | 204; also deletes that bike's blobs |
| PUT | `/api/bikes/:id/pills` | full replace, `{"pill_ids": [...]}` |
| GET/POST | `/api/bikes/:id/maintenance` | list is date-descending |
| PATCH/DELETE | `/api/bikes/:id/maintenance/:recordId` | scoped to the bike |
| POST | `/api/bikes/:id/images` | multipart `files`, `thumb`, `original_name` |
| PATCH/DELETE | `/api/bikes/:id/images/:imageId` | primary flag, sort order |
| GET | `/api/pills`, POST `/api/pills` | POST 201 |
| DELETE | `/api/pills/:id` | 204 |
| GET | `/api/images/:bikeId/:filename` | streams from Blobs, immutable cache header |
| GET | `/api/export` | downloads `bike_view.json` |
| POST | `/api/import` | multipart field `file`; replaces all rows |

Errors keep the FastAPI envelope: `{"detail": "..."}`.

## Images

Photos never pass through a full-size upload to the function. The browser
(`public/static/js/image-upload.js`):

- honors EXIF orientation with `createImageBitmap(file, { imageOrientation: "from-image" })`;
- flattens transparency onto white and re-encodes JPEG at quality 0.85;
- produces a full image (long edge ≤ 2000 px) and a thumbnail (≤ 1024 px),
  never upscaling — the same constants as the original Pillow pipeline;
- uploads each photo as one request (`files` + `thumb`), sequentially.

The function keeps the trust boundary: bike must exist, parts must be JPEG
(magic-byte sniff), and sizes are capped (full 8 MB, thumb 4 MB — unreachable
for browser-processed pairs, but defense in depth). Netlify caps a function
request at 6 MB, hence per-file uploads. HEIC photos decode in Safari; other
browsers show a clear per-file error asking for JPG/PNG.

Missing blobs (or image rows whose files were never migrated) fall back to
`/static/img/placeholder-bike.svg` via `image-fallback.js`.

## Deliberate differences from the Python app

- **Import cap 4 MB** (was 10 MB) to stay under Netlify's 6 MB request limit.
  Exports are JSON metadata only, so this is ample.
- **Images are processed in the browser**, not by Pillow, and uploads are
  atomic per photo rather than per batch. One failed photo does not roll back
  the others.
- **Non-integer path ids** fall through to 404 instead of FastAPI's 422.
  The front-end never generates such URLs.
- **Unknown pill ids** on `PUT /api/bikes/:id/pills` return 422 instead of
  the original's unhandled `IntegrityError` → 500.
- **Ordering of pill labels** follows Postgres collation, which can order
  mixed-case labels slightly differently from SQLite. Cosmetic.
- **Export/import covers database rows, not photo bytes.** The export lists
  image filenames; Blobs is the photo store. Importing on the same site can
  reuse blobs that still exist under the same bike id and filename. Copying
  photos to another site is a separate Blobs upload step.
- Timestamps come back from Postgres as ISO 8601 (`...Z`) rather than
  SQLite's `YYYY-MM-DD HH:MM:SS` strings.

## Preview deploys

Preview deploys get their own Netlify Database branch seeded from production,
but previews and production share the same Blobs store. An upload made in a
preview writes its row to the preview database and a blob that production may
never reference — a harmless orphan. Take care with import/destructive actions
in previews.

## Troubleshooting

- **`The database schema does not exist yet`** — for local dev, run
  `npx netlify database migrations apply` against the local database; for a
  remote database, deploy once so migrations run.
- **`NETLIFY_DB_URL is not set`** when migrating — fill in `.env` from
  `.env.example`; the script loads it automatically.
- **API returns 404** — check that the site is linked (`netlify link`) and that
  `netlify/functions/api.ts` was detected; the route is `/api/*`.
- **A 404 detail says `Not Found` under `netlify dev`** — the CLI's local proxy
  retries `/x.html`, `/x/index.html`, … after any 404 and returns the last
  retry's body, so route-specific details like `Bike not found` are replaced
  locally. The status is correct, production is unaffected, and invoking the
  bundled function directly returns the real detail.
- **Images render as the placeholder** — the image row exists but the blob is
  missing. Check the migration's "missing file" warnings.
- **`netlify dev` talks to the production database / Blobs** — remove or
  comment `NETLIFY_DB_URL`, `NETLIFY_SITE_ID`, and `NETLIFY_BLOBS_TOKEN` in
  `.env`. Those variables exist for the one-time migration script and override
  the local database and Blobs sandbox.
- **Every request returns 503 `Site authentication is not configured`** —
  `SITE_PASSWORD_HASH` is missing or is not a 64-character hex SHA-256.
  Generate it with `echo -n "your-password" | shasum -a 256` and set it both
  locally and in the Netlify UI.
- **The browser keeps prompting for a password** — the hash was made from the
  wrong string (note the `-n`: a trailing newline changes the hash), or the
  username does not match `SITE_AUTH_USER`. Fix the values; browsers cache
  rejected Basic Auth attempts per origin, so try a private window.
