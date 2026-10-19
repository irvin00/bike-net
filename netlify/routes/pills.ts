/** /api/pills — port of app/routes/pills.py. */
import { HttpError, json, noContent, readJsonBody } from "../lib/http.js";
import { query, queryOne, type PillRow } from "../lib/db.js";
import { parsePillCreate } from "../lib/validate.js";

const DUPLICATE_LABEL = "A pill with this label already exists";

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string }).code === "23505";
}

export async function list(): Promise<Response> {
  return json(await query<PillRow>("SELECT * FROM pills ORDER BY label"));
}

export async function create(req: Request): Promise<Response> {
  const body = parsePillCreate(await readJsonBody(req));
  const label = body.label.trim();
  if (!label) throw new HttpError(422, "Label is required");

  const existing = await queryOne("SELECT 1 FROM pills WHERE label = $1", [label]);
  if (existing) throw new HttpError(409, DUPLICATE_LABEL);

  let row: PillRow | null;
  try {
    row = await queryOne<PillRow>(
      "INSERT INTO pills (label, color) VALUES ($1, $2) RETURNING *",
      [label, body.color],
    );
  } catch (error) {
    // Race backstop for the pre-check above.
    if (isUniqueViolation(error)) throw new HttpError(409, DUPLICATE_LABEL);
    throw error;
  }
  return json(row, 201);
}

export async function remove(
  _req: Request,
  params: Record<string, string>,
): Promise<Response> {
  const deleted = await queryOne<{ id: number }>(
    "DELETE FROM pills WHERE id = $1 RETURNING id",
    [Number(params.pillId)],
  );
  if (!deleted) throw new HttpError(404, "Pill not found");
  return noContent();
}
