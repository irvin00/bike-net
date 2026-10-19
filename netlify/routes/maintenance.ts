/** /api/bikes/{id}/maintenance — port of app/routes/maintenance.py. */
import { HttpError, json, noContent, readJsonBody } from "../lib/http.js";
import {
  bikeExists,
  query,
  queryOne,
  type MaintenanceRow,
} from "../lib/db.js";
import {
  parseMaintenanceCreate,
  parseMaintenanceUpdate,
} from "../lib/validate.js";

type Params = Record<string, string>;

export async function list(
  _req: Request,
  params: Params,
): Promise<Response> {
  const bikeId = Number(params.bikeId);
  if (!(await bikeExists(bikeId))) throw new HttpError(404, "Bike not found");
  return json(
    await query<MaintenanceRow>(
      "SELECT * FROM maintenance_records WHERE bike_id = $1 ORDER BY date DESC",
      [bikeId],
    ),
  );
}

export async function create(
  req: Request,
  params: Params,
): Promise<Response> {
  const bikeId = Number(params.bikeId);
  if (!(await bikeExists(bikeId))) throw new HttpError(404, "Bike not found");

  const body = parseMaintenanceCreate(await readJsonBody(req));
  const row = await queryOne<MaintenanceRow>(
    `INSERT INTO maintenance_records (bike_id, date, description, cost)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [bikeId, body.date, body.description, body.cost],
  );
  return json(row, 201);
}

export async function update(
  req: Request,
  params: Params,
): Promise<Response> {
  const bikeId = Number(params.bikeId);
  const recordId = Number(params.recordId);
  const row = await queryOne<MaintenanceRow>(
    "SELECT * FROM maintenance_records WHERE id = $1 AND bike_id = $2",
    [recordId, bikeId],
  );
  if (!row) throw new HttpError(404, "Record not found");

  const updates = parseMaintenanceUpdate(await readJsonBody(req));
  const entries = Object.entries(updates);
  if (entries.length === 0) return json(row);

  const values: unknown[] = [];
  const sets = entries.map(([key, value]) => {
    values.push(value);
    return `${key} = $${values.length}`;
  });
  values.push(recordId, bikeId);

  const updated = await queryOne<MaintenanceRow>(
    `UPDATE maintenance_records SET ${sets.join(", ")}
      WHERE id = $${values.length - 1} AND bike_id = $${values.length}
      RETURNING *`,
    values,
  );
  return json(updated!);
}

export async function remove(
  _req: Request,
  params: Params,
): Promise<Response> {
  const deleted = await queryOne<{ id: number }>(
    "DELETE FROM maintenance_records WHERE id = $1 AND bike_id = $2 RETURNING id",
    [Number(params.recordId), Number(params.bikeId)],
  );
  if (!deleted) throw new HttpError(404, "Record not found");
  return noContent();
}
