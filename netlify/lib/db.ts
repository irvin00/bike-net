/**
 * Netlify Database (managed Postgres) access.
 *
 * Connection resolution is delegated to @netlify/database: inside Functions
 * it reads NETLIFY_DB_URL from the runtime environment; local `netlify dev`
 * and the migration script supply the same variable. The pool is created
 * lazily so importing a route module outside a request never connects.
 *
 * Queries are parameterized ($1, $2, ...). Only allowlisted column names are
 * ever interpolated into SQL.
 */
import { getDatabase } from "@netlify/database";

export type Row = Record<string, unknown>;

interface QueryResult<T> {
  rows: T[];
}

interface ClientLike {
  query<T = Row>(text: string, values?: unknown[]): Promise<QueryResult<T>>;
  release(): void;
}

interface PoolLike {
  query<T = Row>(text: string, values?: unknown[]): Promise<QueryResult<T>>;
  connect(): Promise<ClientLike>;
}

let poolCache: PoolLike | null = null;

function pool(): PoolLike {
  if (!poolCache) {
    poolCache = getDatabase().pool as unknown as PoolLike;
  }
  return poolCache;
}

export async function query<T = Row>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const result = await pool().query<T>(text, params);
  return result.rows;
}

export async function queryOne<T = Row>(
  text: string,
  params: unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}

export interface Tx {
  query<T = Row>(text: string, params?: unknown[]): Promise<T[]>;
}

/** Run fn inside BEGIN/COMMIT on a dedicated client, rolling back on error. */
export async function withTransaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  const client = await pool().connect();
  const tx: Tx = {
    query: async <R = Row>(text: string, params: unknown[] = []) =>
      (await client.query<R>(text, params)).rows,
  };
  try {
    await client.query("BEGIN");
    const result = await fn(tx);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Connection already broken — the pool will discard it.
    }
    throw error;
  } finally {
    client.release();
  }
}

// --- Row shapes (mirror netlify/database/migrations/0001_init.sql) ---

export interface BikeRow {
  id: number;
  name: string;
  description: string;
  full_story: string;
  status: string;
  acquired_on: string | null;
  retired_on: string | null;
  created_at: string;
  updated_at: string;
  [key: string]: unknown;
}

export interface PillRow {
  id: number;
  label: string;
  color: string;
  [key: string]: unknown;
}

export interface ImageRow {
  id: number;
  bike_id: number;
  filename: string;
  original_name: string;
  is_primary: number;
  sort_order: number;
  created_at: string;
  [key: string]: unknown;
}

export interface MaintenanceRow {
  id: number;
  bike_id: number;
  date: string;
  description: string;
  cost: number | null;
  created_at: string;
  [key: string]: unknown;
}

// --- Shared serialization ---

/** Port of app.image_store.thumb_filename (rsplit on the last dot). */
export function thumbFilename(filename: string): string {
  const dot = filename.lastIndexOf(".");
  const stem = dot === -1 ? filename : filename.slice(0, dot);
  return `${stem}.thumb.jpg`;
}

export interface SerializedImage extends ImageRow {
  url: string;
  thumb_url: string;
}

export function serializeImage(row: ImageRow, bikeId = row.bike_id): SerializedImage {
  return {
    ...row,
    url: `/api/images/${bikeId}/${row.filename}`,
    thumb_url: `/api/images/${bikeId}/${thumbFilename(row.filename)}`,
  };
}

/** Attach the bike's pills (label order), matching _attach_pills in bikes.py. */
export async function attachPills<T extends { id: number }>(
  bike: T,
): Promise<T & { pills: PillRow[] }> {
  const pills = await query<PillRow>(
    `SELECT p.id, p.label, p.color
       FROM pills p
       JOIN bike_pills bp ON bp.pill_id = p.id
      WHERE bp.bike_id = $1
      ORDER BY p.label`,
    [bike.id],
  );
  return { ...bike, pills };
}

/** Attach primary_image / primary_thumb for the home-card grid. */
export async function attachPrimaryImage<
  T extends { id: number },
>(bike: T): Promise<T & { primary_image: string | null; primary_thumb: string | null }> {
  const row = await queryOne<{ filename: string }>(
    "SELECT filename FROM images WHERE bike_id = $1 AND is_primary = 1 LIMIT 1",
    [bike.id],
  );
  const filename = row?.filename ?? null;
  return {
    ...bike,
    primary_image: filename,
    primary_thumb: filename ? thumbFilename(filename) : null,
  };
}

export async function bikeExists(bikeId: number): Promise<boolean> {
  const row = await queryOne("SELECT 1 FROM bikes WHERE id = $1", [bikeId]);
  return row !== null;
}
