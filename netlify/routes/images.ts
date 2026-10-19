/**
 * /api/bikes/{id}/images — port of app/routes/images.py.
 *
 * The browser now does the Pillow work (resize, EXIF orientation, white
 * alpha flatten, JPEG q85) before uploading, because Netlify rejects
 * requests over 6MB. The server keeps the trust boundary: bike existence,
 * content-type check, byte caps, and a JPEG magic-byte sniff. The client
 * sends the processed full image + thumbnail together, one photo per request.
 */
import { randomUUID } from "node:crypto";
import {
  HttpError,
  getFiles,
  getText,
  json,
  noContent,
  readFormData,
  readJsonBody,
} from "../lib/http.js";
import {
  bikeExists,
  queryOne,
  serializeImage,
  thumbFilename,
  withTransaction,
  type ImageRow,
  type SerializedImage,
} from "../lib/db.js";
import { parseImageUpdate } from "../lib/validate.js";
import { deleteImagePair, putImage } from "../lib/store.js";

type Params = Record<string, string>;

// The 6MB function request cap makes these unreachable for processed pair
// uploads; they exist as a defense-in-depth ceiling (Pillow's 25MB gate on
// the raw file now runs client-side).
const MAX_FULL_BYTES = 8 * 1024 * 1024;
const MAX_THUMB_BYTES = 4 * 1024 * 1024;

/** Port of image_store._sanitize_stem (Path(...).stem + cleanup). */
function sanitizeStem(originalName: string): string {
  const base = (originalName || "image").split(/[/\\]/).pop() || "image";
  const dot = base.lastIndexOf(".");
  let stem = dot > 0 ? base.slice(0, dot) : base;
  stem = stem.replace(/[^A-Za-z0-9._-]+/g, "_");
  stem = stem.replace(/^[._-]+|[._-]+$/g, "").slice(0, 60) || "image";
  return stem;
}

function newFilename(originalName: string): string {
  return `${randomUUID().replace(/-/g, "")}-${sanitizeStem(originalName)}.jpg`;
}

function looksLikeJpeg(bytes: Uint8Array): boolean {
  return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

interface PreparedImage {
  full: Uint8Array;
  thumb: Uint8Array;
  originalName: string;
}

async function prepare(
  full: File,
  thumb: File,
  originalName: string,
): Promise<PreparedImage> {
  if (full.size === 0) throw new HttpError(400, `${originalName}: empty file`);
  if (full.size > MAX_FULL_BYTES) {
    throw new HttpError(400, `${originalName}: file too large`);
  }
  if (!(full.type || "").startsWith("image/")) {
    throw new HttpError(400, `${originalName}: not an image file`);
  }
  if (thumb.size === 0) {
    throw new HttpError(400, `${originalName}: empty thumbnail`);
  }
  if (thumb.size > MAX_THUMB_BYTES) {
    throw new HttpError(400, `${originalName}: thumbnail too large`);
  }

  const fullBytes = new Uint8Array(await full.arrayBuffer());
  const thumbBytes = new Uint8Array(await thumb.arrayBuffer());
  // Cheapest reliable format check without an image decoder in the function.
  if (!looksLikeJpeg(fullBytes) || !looksLikeJpeg(thumbBytes)) {
    throw new HttpError(400, `${originalName}: Not a valid image`);
  }
  return { full: fullBytes, thumb: thumbBytes, originalName };
}

export async function create(req: Request, params: Params): Promise<Response> {
  const bikeId = Number(params.bikeId);
  if (!(await bikeExists(bikeId))) throw new HttpError(404, "Bike not found");

  const form = await readFormData(req);
  const fullFiles = getFiles(form, "files");
  const thumbFiles = getFiles(form, "thumb");
  if (fullFiles.length === 0) throw new HttpError(422, "files: Field required");
  if (fullFiles.length !== thumbFiles.length) {
    throw new HttpError(400, "Each image must include a matching thumbnail");
  }

  const originalField = getText(form, "original_name");
  const prepared: PreparedImage[] = [];
  for (let i = 0; i < fullFiles.length; i += 1) {
    const originalName =
      fullFiles.length === 1 && originalField
        ? originalField
        : fullFiles[i].name || "image";
    prepared.push(await prepare(fullFiles[i], thumbFiles[i], originalName));
  }

  const created: SerializedImage[] = [];
  for (const item of prepared) {
    const filename = newFilename(item.originalName);
    const thumbName = thumbFilename(filename);

    // Blobs first, DB row second: a crash in between leaves an orphan blob
    // (harmless) rather than a row pointing at missing bytes.
    await putImage(bikeId, filename, item.full);
    try {
      await putImage(bikeId, thumbName, item.thumb);
    } catch (error) {
      await deleteImagePair(bikeId, filename, thumbName);
      throw error;
    }

    let row: ImageRow;
    try {
      row = await withTransaction(async (tx) => {
        // Lock the bike row so concurrent uploads serialize their sort_order
        // and first-image-becomes-primary decision.
        const bike = await tx.query("SELECT id FROM bikes WHERE id = $1 FOR UPDATE", [
          bikeId,
        ]);
        if (bike.length === 0) throw new HttpError(404, "Bike not found");

        const stats = await tx.query<{ next_sort: number; count: number }>(
          `SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_sort,
                  COUNT(*)::int AS count
             FROM images WHERE bike_id = $1`,
          [bikeId],
        );
        const nextSort = Number(stats[0]?.next_sort ?? 0);
        const isPrimary = Number(stats[0]?.count ?? 0) === 0 ? 1 : 0;

        const inserted = await tx.query<ImageRow>(
          `INSERT INTO images (bike_id, filename, original_name, is_primary, sort_order)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING *`,
          [bikeId, filename, item.originalName, isPrimary, nextSort],
        );
        return inserted[0];
      });
    } catch (error) {
      await deleteImagePair(bikeId, filename, thumbName);
      throw error;
    }

    created.push(serializeImage(row, bikeId));
  }

  return json(created, 201);
}

export async function update(req: Request, params: Params): Promise<Response> {
  const bikeId = Number(params.bikeId);
  const imageId = Number(params.imageId);
  const row = await queryOne<ImageRow>(
    "SELECT * FROM images WHERE id = $1 AND bike_id = $2",
    [imageId, bikeId],
  );
  if (!row) throw new HttpError(404, "Image not found");

  const updates = parseImageUpdate(await readJsonBody(req));
  if (Object.keys(updates).length === 0) return json(serializeImage(row, bikeId));

  await withTransaction(async (tx) => {
    if (updates.is_primary === true) {
      // At-most-one-primary per bike is enforced here (no DB constraint).
      await tx.query("UPDATE images SET is_primary = 0 WHERE bike_id = $1", [bikeId]);
      await tx.query(
        "UPDATE images SET is_primary = 1 WHERE id = $1 AND bike_id = $2",
        [imageId, bikeId],
      );
    } else if (updates.is_primary === false) {
      // Allowed: leaves the bike without a primary; cards show the placeholder.
      await tx.query(
        "UPDATE images SET is_primary = 0 WHERE id = $1 AND bike_id = $2",
        [imageId, bikeId],
      );
    }
    if (updates.sort_order !== undefined) {
      await tx.query(
        "UPDATE images SET sort_order = $1 WHERE id = $2 AND bike_id = $3",
        [updates.sort_order, imageId, bikeId],
      );
    }
  });

  const updated = await queryOne<ImageRow>("SELECT * FROM images WHERE id = $1", [
    imageId,
  ]);
  return json(serializeImage(updated ?? row, bikeId));
}

export async function remove(_req: Request, params: Params): Promise<Response> {
  const bikeId = Number(params.bikeId);
  const imageId = Number(params.imageId);
  const row = await queryOne<ImageRow>(
    "SELECT * FROM images WHERE id = $1 AND bike_id = $2",
    [imageId, bikeId],
  );
  if (!row) throw new HttpError(404, "Image not found");

  await withTransaction(async (tx) => {
    await tx.query("DELETE FROM images WHERE id = $1", [imageId]);
    if (row.is_primary) {
      // Promote the lowest sort_order remaining (tie-break: oldest id).
      // The client mirrors this rule locally — keep the two in sync.
      const candidate = await tx.query<{ id: number }>(
        "SELECT id FROM images WHERE bike_id = $1 ORDER BY sort_order, id LIMIT 1",
        [bikeId],
      );
      if (candidate[0]) {
        await tx.query("UPDATE images SET is_primary = 1 WHERE id = $1", [
          candidate[0].id,
        ]);
      }
    }
  });

  // DB first, then blobs — a failed delete leaves a harmless orphan.
  await deleteImagePair(bikeId, row.filename, thumbFilename(row.filename));
  return noContent();
}
