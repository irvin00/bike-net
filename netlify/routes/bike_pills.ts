/**
 * PUT /api/bikes/{id}/pills — full-replace pill attachments, port of
 * app/routes/bike_pills.py. Unknown pill ids are a 422 instead of the
 * Python app's IntegrityError → 500 (a deliberate, frontend-invisible fix).
 */
import { HttpError, json, readJsonBody } from "../lib/http.js";
import { bikeExists, query, withTransaction, type PillRow } from "../lib/db.js";
import { parsePillSet } from "../lib/validate.js";

export async function set(
  req: Request,
  params: Record<string, string>,
): Promise<Response> {
  const bikeId = Number(params.bikeId);
  if (!(await bikeExists(bikeId))) throw new HttpError(404, "Bike not found");

  const requested = parsePillSet(await readJsonBody(req));
  const pillIds = [...new Set(requested)];

  if (pillIds.length > 0) {
    const rows = await query<{ id: number }>(
      "SELECT id FROM pills WHERE id = ANY($1::int[])",
      [pillIds],
    );
    const known = new Set(rows.map((row) => row.id));
    for (const id of pillIds) {
      if (!known.has(id)) throw new HttpError(422, `Unknown pill id ${id}`);
    }
  }

  await withTransaction(async (tx) => {
    await tx.query("DELETE FROM bike_pills WHERE bike_id = $1", [bikeId]);
    for (const pillId of pillIds) {
      await tx.query(
        "INSERT INTO bike_pills (bike_id, pill_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
        [bikeId, pillId],
      );
    }
  });

  const pills = await query<PillRow>(
    `SELECT p.id, p.label, p.color
       FROM pills p
       JOIN bike_pills bp ON bp.pill_id = p.id
      WHERE bp.bike_id = $1
      ORDER BY p.label`,
    [bikeId],
  );
  return json(pills);
}
