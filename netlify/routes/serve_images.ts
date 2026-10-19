/**
 * GET /api/images/{bike_id}/{filename} — Blobs-backed replacement for
 * serve_images.py. Generated filenames are random and immutable, so responses
 * are cacheable forever; a missing blob is a 404 that image-fallback.js turns
 * into the placeholder.
 */
import { HttpError } from "../lib/http.js";
import { getImage } from "../lib/store.js";

export async function get(
  _req: Request,
  params: Record<string, string>,
): Promise<Response> {
  let filename: string;
  try {
    filename = decodeURIComponent(params.filename);
  } catch {
    throw new HttpError(404, "Image not found");
  }

  // Defense in depth: the route regex already stops "/", but reject the rest.
  if (
    !filename ||
    filename.includes("/") ||
    filename.includes("\\") ||
    filename.includes("..")
  ) {
    throw new HttpError(404, "Image not found");
  }

  const stream = await getImage(Number(params.bikeId), filename);
  if (!stream) throw new HttpError(404, "Image not found");

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
