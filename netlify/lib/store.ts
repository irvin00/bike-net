/**
 * Netlify Blobs access for bike photos. Keys mirror the original uploads
 * layout: bikes/<bike_id>/<filename> and bikes/<bike_id>/<filename>.thumb.jpg.
 *
 * In Functions the SDK auto-detects the site from the runtime context (and
 * `netlify dev` uses a sandboxed local store). Outside Functions — i.e. the
 * one-shot migration script — NETLIFY_SITE_ID and NETLIFY_BLOBS_TOKEN must be
 * set, and are passed explicitly.
 */
import { getStore } from "@netlify/blobs";

const STORE_NAME = "bike-view-images";

type BlobStore = ReturnType<typeof getStore>;

let cached: BlobStore | null = null;

export function imageStore(): BlobStore {
  if (cached) return cached;

  const siteID = process.env.NETLIFY_SITE_ID;
  const token = process.env.NETLIFY_BLOBS_TOKEN;

  cached =
    siteID && token
      ? getStore({ name: STORE_NAME, consistency: "strong", siteID, token })
      : getStore({ name: STORE_NAME, consistency: "strong" });
  return cached;
}

export function imageKey(bikeId: number, filename: string): string {
  return `bikes/${bikeId}/${filename}`;
}

export async function putImage(
  bikeId: number,
  filename: string,
  data: Uint8Array,
): Promise<void> {
  // Blob (rather than a bare buffer) keeps a JPEG content type on the stored
  // object; the serving function also sets one explicitly.
  await imageStore().set(
    imageKey(bikeId, filename),
    new Blob([new Uint8Array(data)], { type: "image/jpeg" }),
  );
}

export async function deleteImagePair(
  bikeId: number,
  filename: string,
  thumbName: string,
): Promise<void> {
  // Best-effort: a failed delete leaves a harmless orphan, never a dangling row.
  await Promise.allSettled([
    imageStore().delete(imageKey(bikeId, filename)),
    imageStore().delete(imageKey(bikeId, thumbName)),
  ]);
}

/** Remove every blob under a bike's prefix (after the DB row is gone). */
export async function deleteBikeImages(bikeId: number): Promise<void> {
  const store = imageStore();
  for await (const page of store.list({ prefix: `bikes/${bikeId}/`, paginate: true })) {
    await Promise.allSettled(page.blobs.map((blob) => store.delete(blob.key)));
  }
}

/** Stream a stored image, or null when the key does not exist. */
export async function getImage(
  bikeId: number,
  filename: string,
): Promise<ReadableStream | null> {
  // The SDK returns null on a 404 even for typed gets (its types omit the null).
  return (await imageStore().get(imageKey(bikeId, filename), {
    type: "stream",
  })) as ReadableStream | null;
}
