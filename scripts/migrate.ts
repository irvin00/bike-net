/**
 * One-time migration: original SQLite database + uploads/ → Netlify Database
 * + Netlify Blobs.
 *
 * Run it from the repo root after the database schema exists (deploy, or
 * `netlify database migrations apply`) and after creating a Blobs token:
 *
 *   cp .env.example .env   # fill in NETLIFY_DB_URL, NETLIFY_SITE_ID, NETLIFY_BLOBS_TOKEN
 *   npm run migrate        # refuses to touch a non-empty target database
 *   npm run migrate -- --force   # wipe bikes/pills/images rows and restore
 *
 * Bikes and pills keep their ids (bike_pills depends on them); images and
 * maintenance records get fresh ids. Both identity sequences are reset so the
 * next create cannot collide. Image rows are restored even when their files
 * are missing on disk — the UI falls back to the placeholder, exactly like
 * the app's own export/import semantics. Run it once; --force makes it
 * repeatable but replaces all existing data.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { getStore } from "@netlify/blobs";
import { getDatabase } from "@netlify/database";

// --- Environment ---

const envPath = join(process.cwd(), ".env");
if (existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

const force = process.argv.includes("--force");

const connectionString = process.env.NETLIFY_DB_URL;
const siteID = process.env.NETLIFY_SITE_ID;
const token = process.env.NETLIFY_BLOBS_TOKEN;

if (!connectionString) {
  console.error(
    "NETLIFY_DB_URL is not set. Copy .env.example to .env and fill it in\n" +
      "(or export it in your shell). Get the production connection string from\n" +
      "Netlify UI → Database, or `netlify database status --branch production --show-credentials --json`.",
  );
  process.exit(1);
}
if (!siteID || !token) {
  console.error(
    "NETLIFY_SITE_ID and NETLIFY_BLOBS_TOKEN are required to upload images\n" +
      "from outside a Netlify Function. See .env.example for where to find them.",
  );
  process.exit(1);
}

const oldRepo = resolve(process.env.OLD_REPO || join(process.cwd(), "..", "bike_view"));
const sqlitePath = resolve(
  process.env.OLD_DB_PATH || join(oldRepo, "data", "bike_view.db"),
);
const uploadsDir = resolve(process.env.OLD_UPLOADS || join(oldRepo, "uploads"));

if (!existsSync(sqlitePath)) {
  console.error(`SQLite database not found at ${sqlitePath}`);
  console.error("Set OLD_REPO or OLD_DB_PATH to point at the original app.");
  process.exit(1);
}

// --- Read the old SQLite database (read-only) ---

interface PillRow {
  id: number;
  label: string;
  color: string;
}
interface BikeRow {
  id: number;
  name: string;
  description: string;
  full_story: string;
  status: string;
  acquired_on: string | null;
  retired_on: string | null;
  created_at: string;
  updated_at: string;
}
interface BikePillRow {
  bike_id: number;
  pill_id: number;
}
interface MaintenanceRow {
  id: number;
  bike_id: number;
  date: string;
  description: string;
  cost: number | null;
  created_at: string;
}
interface ImageRow {
  id: number;
  bike_id: number;
  filename: string;
  original_name: string;
  is_primary: number;
  sort_order: number;
  created_at: string;
}

const sqlite = new DatabaseSync(sqlitePath, { readOnly: true });

function readAll<T>(sql: string): T[] {
  return sqlite.prepare(sql).all() as unknown as T[];
}

let pills: PillRow[];
let bikes: BikeRow[];
let bikePills: BikePillRow[];
let maintenance: MaintenanceRow[];
let images: ImageRow[];
try {
  pills = readAll<PillRow>("SELECT * FROM pills ORDER BY id");
  bikes = readAll<BikeRow>("SELECT * FROM bikes ORDER BY id");
  bikePills = readAll<BikePillRow>(
    "SELECT * FROM bike_pills ORDER BY bike_id, pill_id",
  );
  maintenance = readAll<MaintenanceRow>(
    "SELECT * FROM maintenance_records ORDER BY id",
  );
  images = readAll<ImageRow>("SELECT * FROM images ORDER BY id");
} catch (error) {
  console.error(`Could not read ${sqlitePath}:`, error);
  process.exit(1);
} finally {
  sqlite.close();
}

console.log(`Read from ${sqlitePath}`);
console.log(
  `  ${bikes.length} bikes, ${pills.length} pills, ${bikePills.length} bike-pill links, ` +
    `${maintenance.length} maintenance records, ${images.length} images`,
);

// --- Connect to Netlify Database ---

interface DbClient {
  query(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: Record<string, unknown>[] }>;
  release(): void;
}
interface DbPool {
  connect(): Promise<DbClient>;
}

let client: DbClient;
try {
  const db = getDatabase({ connectionString });
  client = await (db.pool as unknown as DbPool).connect();
} catch (error) {
  console.error(
    "Could not connect to Netlify Database. Check NETLIFY_DB_URL\n" +
      "(get it with `netlify database connect --json`).",
  );
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

let exitCode = 0;

try {
  // --- Guard: don't overwrite data by accident ---

  try {
    const existing = await client.query(
      `SELECT (SELECT COUNT(*)::int FROM bikes) AS bikes,
              (SELECT COUNT(*)::int FROM pills) AS pills`,
    );
    const bikesInTarget = Number(existing.rows[0]?.bikes ?? 0);
    const pillsInTarget = Number(existing.rows[0]?.pills ?? 0);

    if (!force && (bikesInTarget > 0 || pillsInTarget > 0)) {
      console.error(
        `Target database already has ${bikesInTarget} bikes and ${pillsInTarget} pills. ` +
          "Re-run with --force to wipe and restore from SQLite.",
      );
      process.exitCode = 1;
      throw new Error("target-not-empty");
    }
  } catch (error) {
    if ((error as { code?: string }).code === "42P01") {
      console.error(
        "The database schema does not exist yet. Apply migrations first:\n" +
          "  netlify database migrations apply\n" +
          "(on a linked site), or deploy once — migrations run automatically.",
      );
      process.exitCode = 1;
      throw new Error("missing-schema");
    }
    throw error;
  }

  // --- Restore rows in one transaction ---

  await client.query("BEGIN");
  try {
    await client.query("DELETE FROM bike_pills");
    await client.query("DELETE FROM maintenance_records");
    await client.query("DELETE FROM images");
    await client.query("DELETE FROM bikes");
    await client.query("DELETE FROM pills");

    for (const pill of pills) {
      await client.query(
        `INSERT INTO pills (id, label, color)
         OVERRIDING SYSTEM VALUE
         VALUES ($1, $2, $3)`,
        [pill.id, pill.label, pill.color],
      );
    }

    for (const bike of bikes) {
      await client.query(
        `INSERT INTO bikes (id, name, description, full_story, status,
                            acquired_on, retired_on, created_at, updated_at)
         OVERRIDING SYSTEM VALUE
         VALUES ($1, $2, $3, $4, $5, $6, $7,
                 COALESCE($8::timestamptz, now()),
                 COALESCE($9::timestamptz, now()))`,
        [
          bike.id,
          bike.name,
          bike.description,
          bike.full_story,
          bike.status,
          bike.acquired_on,
          bike.retired_on,
          bike.created_at,
          bike.updated_at,
        ],
      );
    }

    for (const link of bikePills) {
      await client.query(
        `INSERT INTO bike_pills (bike_id, pill_id) VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [link.bike_id, link.pill_id],
      );
    }

    for (const record of maintenance) {
      await client.query(
        `INSERT INTO maintenance_records (bike_id, date, description, cost, created_at)
         VALUES ($1, $2, $3, $4, COALESCE($5::timestamptz, now()))`,
        [
          record.bike_id,
          record.date,
          record.description,
          record.cost,
          record.created_at,
        ],
      );
    }

    for (const image of images) {
      await client.query(
        `INSERT INTO images (bike_id, filename, original_name, is_primary, sort_order, created_at)
         VALUES ($1, $2, $3, $4, $5, COALESCE($6::timestamptz, now()))`,
        [
          image.bike_id,
          image.filename,
          image.original_name,
          image.is_primary,
          image.sort_order,
          image.created_at,
        ],
      );
    }

    // Preserved ids do not advance the identity sequences; reset both or the
    // next created bike/pill collides with an existing id.
    await client.query(
      `SELECT setval(
         pg_get_serial_sequence('bikes', 'id'),
         COALESCE((SELECT MAX(id) FROM bikes), 0) + 1,
         false
       )`,
    );
    await client.query(
      `SELECT setval(
         pg_get_serial_sequence('pills', 'id'),
         COALESCE((SELECT MAX(id) FROM pills), 0) + 1,
         false
       )`,
    );

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }

  // --- Verify counts ---

  const verified = await client.query(
    `SELECT (SELECT COUNT(*)::int FROM bikes) AS bikes,
            (SELECT COUNT(*)::int FROM pills) AS pills,
            (SELECT COUNT(*)::int FROM bike_pills) AS bike_pills,
            (SELECT COUNT(*)::int FROM maintenance_records) AS maintenance,
            (SELECT COUNT(*)::int FROM images) AS images`,
  );
  const counts = verified.rows[0] ?? {};
  console.log("Restored into Netlify Database:");
  console.log(
    `  ${counts.bikes} bikes, ${counts.pills} pills, ${counts.bike_pills} bike-pill links, ` +
      `${counts.maintenance} maintenance records, ${counts.images} images`,
  );

  // --- Upload image files to Blobs ---

  const store = getStore({
    name: "bike-view-images",
    consistency: "strong",
    siteID,
    token,
  });

  function thumbFilename(filename: string): string {
    const dot = filename.lastIndexOf(".");
    const stem = dot === -1 ? filename : filename.slice(0, dot);
    return `${stem}.thumb.jpg`;
  }

  const expected = new Set<string>();
  let uploaded = 0;
  let missing = 0;
  let failed = 0;

  for (const image of images) {
    const names = [image.filename, thumbFilename(image.filename)];
    for (const name of names) {
      expected.add(`bikes/${image.bike_id}/${name}`);
      const path = join(uploadsDir, "bikes", String(image.bike_id), name);
      if (!existsSync(path)) {
        console.warn(`  missing file: ${relative(oldRepo, path)} (row kept)`);
        missing += 1;
        continue;
      }
      try {
        const data = new Uint8Array(readFileSync(path));
        await store.set(`bikes/${image.bike_id}/${name}`, new Blob([data], {
          type: "image/jpeg",
        }));
        uploaded += 1;
      } catch (error) {
        failed += 1;
        console.error(`  failed to upload ${relative(oldRepo, path)}:`, error);
        exitCode = 1;
      }
    }
  }

  console.log(`Blobs: uploaded ${uploaded} files, ${missing} missing on disk`);
  if (failed > 0) {
    console.error(`Blobs: ${failed} uploads failed — re-run after fixing access.`);
  }

  // --- Report orphaned files (present on disk, not referenced by a row) ---

  const bikeRoot = join(uploadsDir, "bikes");
  if (existsSync(bikeRoot)) {
    const orphans: string[] = [];
    for (const bikeDir of readdirSync(bikeRoot)) {
      const dir = join(bikeRoot, bikeDir);
      if (!statSync(dir).isDirectory()) continue;
      for (const file of readdirSync(dir)) {
        const key = `bikes/${bikeDir}/${file}`;
        if (!expected.has(key)) orphans.push(relative(oldRepo, join(dir, file)));
      }
    }
    if (orphans.length > 0) {
      console.log(
        `Skipped ${orphans.length} file(s) not referenced by any image row:`,
      );
      for (const orphan of orphans) console.log(`  ${orphan}`);
    }
  }

  if (exitCode === 0) {
    console.log("Migration complete.");
  } else {
    console.error("Migration finished with errors (database rows were restored).");
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (message !== "target-not-empty" && message !== "missing-schema") {
    console.error("Migration failed:", error);
  }
  exitCode = 1;
} finally {
  client.release();
}

process.exitCode = exitCode;
