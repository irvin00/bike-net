/**
 * GET /api/export — port of app/routes/export.py.
 * Nested JSON with every bike's pills, images (url/thumb_url), and
 * maintenance records, plus the pill catalog. Content-Disposition makes a
 * plain anchor download it.
 */
import { attachPills, query, serializeImage, type BikeRow, type ImageRow, type MaintenanceRow, type PillRow } from "../lib/db.js";

export async function get(): Promise<Response> {
  const bikes = await query<BikeRow>("SELECT * FROM bikes ORDER BY id");
  const pills = await query<PillRow>("SELECT * FROM pills ORDER BY label");

  const exported = [];
  for (const bike of bikes) {
    const withPills = await attachPills(bike);
    const images = await query<ImageRow>(
      "SELECT * FROM images WHERE bike_id = $1 ORDER BY is_primary DESC, sort_order, id",
      [bike.id],
    );
    const maintenance = await query<MaintenanceRow>(
      "SELECT * FROM maintenance_records WHERE bike_id = $1 ORDER BY date DESC",
      [bike.id],
    );
    exported.push({
      ...withPills,
      images: images.map((image) => serializeImage(image, bike.id)),
      maintenance_records: maintenance,
    });
  }

  const payload = {
    exported_at: new Date().toISOString(),
    pills,
    bikes: exported,
  };

  return new Response(JSON.stringify(payload, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": 'attachment; filename="bike_view.json"',
    },
  });
}
