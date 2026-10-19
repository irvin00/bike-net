/**
 * POST /api/import — full restore from a bike_view.json export.
 * Port of app/routes/import_data.py. Structural + cross-reference validation
 * runs before any write, then everything restores in one transaction.
 * Bikes and pills keep their ids (bike_pills references pills), then both
 * sequences are reset with setval so the next create cannot collide.
 *
 * Cap: 4MB (was 10MB) because Netlify caps function requests at 6MB. Exports
 * are JSON-only — photos live in Blobs — so this is ample for the app's data.
 */
import { HttpError, json, readFormData } from "../lib/http.js";
import { withTransaction } from "../lib/db.js";
import { parseImportPayload } from "../lib/validate.js";

const MAX_IMPORT_BYTES = 4 * 1024 * 1024;

function isConstraintError(error: unknown): boolean {
  const code = (error as { code?: string }).code;
  return typeof code === "string" && (code.startsWith("23") || code.startsWith("22"));
}

export async function post(req: Request): Promise<Response> {
  const form = await readFormData(req);
  const file = form.get("file");
  if (!file || typeof file === "string") {
    throw new HttpError(422, "No file uploaded");
  }

  const raw = new Uint8Array(await file.arrayBuffer());
  if (raw.byteLength > MAX_IMPORT_BYTES) {
    throw new HttpError(422, "Import file exceeds 4MB limit");
  }

  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    throw new HttpError(422, "File is not a valid bike_view.json export");
  }

  const data = parseImportPayload(payload);

  try {
    await withTransaction(async (tx) => {
      await tx.query("DELETE FROM bike_pills");
      await tx.query("DELETE FROM maintenance_records");
      await tx.query("DELETE FROM images");
      await tx.query("DELETE FROM bikes");
      await tx.query("DELETE FROM pills");

      for (const pill of data.pills) {
        await tx.query(
          `INSERT INTO pills (id, label, color)
           OVERRIDING SYSTEM VALUE
           VALUES ($1, $2, $3)`,
          [pill.id, pill.label, pill.color],
        );
      }

      for (const bike of data.bikes) {
        await tx.query(
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

        for (const ref of bike.pills) {
          await tx.query(
            `INSERT INTO bike_pills (bike_id, pill_id) VALUES ($1, $2)
             ON CONFLICT DO NOTHING`,
            [bike.id, ref.id],
          );
        }

        for (const image of bike.images) {
          await tx.query(
            `INSERT INTO images (bike_id, filename, original_name, is_primary, sort_order)
             VALUES ($1, $2, $3, $4, $5)`,
            [
              bike.id,
              image.filename,
              image.original_name,
              image.is_primary ? 1 : 0,
              image.sort_order,
            ],
          );
        }

        for (const record of bike.maintenance_records) {
          await tx.query(
            `INSERT INTO maintenance_records (bike_id, date, description, cost)
             VALUES ($1, $2, $3, $4)`,
            [bike.id, record.date, record.description, record.cost],
          );
        }
      }

      // Preserved ids do not advance the identity sequences; reset them so
      // the next created bike/pill does not collide.
      await tx.query(
        `SELECT setval(
           pg_get_serial_sequence('bikes', 'id'),
           COALESCE((SELECT MAX(id) FROM bikes), 0) + 1,
           false
         )`,
      );
      await tx.query(
        `SELECT setval(
           pg_get_serial_sequence('pills', 'id'),
           COALESCE((SELECT MAX(id) FROM pills), 0) + 1,
           false
         )`,
      );
    });
  } catch (error) {
    if (error instanceof HttpError) throw error;
    if (isConstraintError(error)) {
      throw new HttpError(
        422,
        `Import failed: data violates database constraints (${
          error instanceof Error ? error.message : String(error)
        })`,
      );
    }
    throw error;
  }

  return json({
    bikes: data.bikes.length,
    pills: data.pills.length,
    images: data.bikes.reduce((sum, bike) => sum + bike.images.length, 0),
    maintenance: data.bikes.reduce(
      (sum, bike) => sum + bike.maintenance_records.length,
      0,
    ),
  });
}
