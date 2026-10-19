/**
 * /api/bikes — port of app/routes/bikes.py.
 * List rows carry pills + primary_image/primary_thumb (no images array);
 * detail rows include the serialized images list.
 */
import { HttpError, json, readJsonBody } from "../lib/http.js";
import {
  attachPills,
  attachPrimaryImage,
  query,
  queryOne,
  serializeImage,
  type BikeRow,
  type ImageRow,
} from "../lib/db.js";
import { parseBikeCreate, parseBikeUpdate } from "../lib/validate.js";
import { deleteBikeImages } from "../lib/store.js";

type Params = Record<string, string>;

export async function list(req: Request): Promise<Response> {
  const status = new URL(req.url).searchParams.get("status");
  const rows =
    status === "active" || status === "former"
      ? await query<BikeRow>(
          "SELECT * FROM bikes WHERE status = $1 ORDER BY created_at DESC",
          [status],
        )
      : await query<BikeRow>("SELECT * FROM bikes ORDER BY created_at DESC");

  const bikes = [];
  for (const row of rows) {
    bikes.push(await attachPrimaryImage(await attachPills(row)));
  }
  return json(bikes);
}

export async function get(_req: Request, params: Params): Promise<Response> {
  const bikeId = Number(params.bikeId);
  const row = await queryOne<BikeRow>("SELECT * FROM bikes WHERE id = $1", [bikeId]);
  if (!row) throw new HttpError(404, "Bike not found");

  const bike = await attachPills(row);
  const images = await query<ImageRow>(
    "SELECT * FROM images WHERE bike_id = $1 ORDER BY is_primary DESC, sort_order, id",
    [bikeId],
  );
  return json({
    ...bike,
    images: images.map((image) => serializeImage(image, bikeId)),
  });
}

export async function create(req: Request): Promise<Response> {
  const body = parseBikeCreate(await readJsonBody(req));
  const row = await queryOne<BikeRow>(
    `INSERT INTO bikes (name, description, full_story, status, acquired_on, retired_on)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      body.name,
      body.description,
      body.full_story,
      body.status,
      body.acquired_on,
      body.retired_on,
    ],
  );
  return json(await attachPills(row!), 201);
}

export async function update(req: Request, params: Params): Promise<Response> {
  const bikeId = Number(params.bikeId);
  const row = await queryOne<BikeRow>("SELECT * FROM bikes WHERE id = $1", [bikeId]);
  if (!row) throw new HttpError(404, "Bike not found");

  const updates = parseBikeUpdate(await readJsonBody(req));
  const entries = Object.entries(updates);
  if (entries.length === 0) return json(await attachPills(row));

  // Column names come from BikeUpdate (a fixed allowlist), never the client.
  const values: unknown[] = [];
  const sets = entries.map(([key, value]) => {
    values.push(value);
    return `${key} = $${values.length}`;
  });
  sets.push("updated_at = now()");
  values.push(bikeId);

  const updated = await queryOne<BikeRow>(
    `UPDATE bikes SET ${sets.join(", ")} WHERE id = $${values.length} RETURNING *`,
    values,
  );
  return json(await attachPills(updated!));
}

export async function remove(_req: Request, params: Params): Promise<Response> {
  const bikeId = Number(params.bikeId);
  const deleted = await queryOne<{ id: number }>(
    "DELETE FROM bikes WHERE id = $1 RETURNING id",
    [bikeId],
  );
  if (!deleted) throw new HttpError(404, "Bike not found");

  // DB first, then blobs — a failed blob delete leaves a harmless orphan,
  // never a dangling row (same ordering as the Python image_store cleanup).
  try {
    await deleteBikeImages(bikeId);
  } catch (error) {
    console.error(`Failed to delete blobs for bike ${bikeId}:`, error);
  }
  return new Response(null, { status: 204 });
}
