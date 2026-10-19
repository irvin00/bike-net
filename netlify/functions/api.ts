/**
 * Single catch-all Netlify Function (Functions v2) for the whole /api surface.
 *
 * One bundle = one cold start and shared DB/Blobs clients; route modules are
 * plain functions. Paths, methods, JSON shapes, status codes and the
 * {"detail": "..."} error envelope match the original FastAPI app, so the
 * static pages' existing JS works unchanged.
 */
import type { Config } from "@netlify/functions";

import { HttpError, json } from "../lib/http.js";
import * as bikes from "../routes/bikes.js";
import * as bikePills from "../routes/bike_pills.js";
import * as exportRoute from "../routes/export.js";
import * as images from "../routes/images.js";
import * as importRoute from "../routes/import_data.js";
import * as maintenance from "../routes/maintenance.js";
import * as pills from "../routes/pills.js";
import * as serveImages from "../routes/serve_images.js";

export const config: Config = {
  path: "/api/*",
};

type Handler = (req: Request, params: Record<string, string>) => Promise<Response>;
type Route = [pattern: RegExp, methods: Record<string, Handler>];

// First match wins. Regexes are anchored and digit-constrained, so no route
// can shadow another; method maps mirror app/main.py's FastAPI routes.
const routes: Route[] = [
  [/^\/api\/bikes$/, { GET: bikes.list, POST: bikes.create }],
  [
    /^\/api\/bikes\/(?<bikeId>\d+)$/,
    { GET: bikes.get, PATCH: bikes.update, DELETE: bikes.remove },
  ],
  [/^\/api\/bikes\/(?<bikeId>\d+)\/pills$/, { PUT: bikePills.set }],
  [
    /^\/api\/bikes\/(?<bikeId>\d+)\/maintenance$/,
    { GET: maintenance.list, POST: maintenance.create },
  ],
  [
    /^\/api\/bikes\/(?<bikeId>\d+)\/maintenance\/(?<recordId>\d+)$/,
    { PATCH: maintenance.update, DELETE: maintenance.remove },
  ],
  [/^\/api\/bikes\/(?<bikeId>\d+)\/images$/, { POST: images.create }],
  [
    /^\/api\/bikes\/(?<bikeId>\d+)\/images\/(?<imageId>\d+)$/,
    { PATCH: images.update, DELETE: images.remove },
  ],
  [/^\/api\/pills$/, { GET: pills.list, POST: pills.create }],
  [/^\/api\/pills\/(?<pillId>\d+)$/, { DELETE: pills.remove }],
  [
    /^\/api\/images\/(?<bikeId>\d+)\/(?<filename>[^/]+)$/,
    { GET: serveImages.get },
  ],
  [/^\/api\/export$/, { GET: exportRoute.get }],
  [/^\/api\/import$/, { POST: importRoute.post }],
];

function normalize(pathname: string): string {
  return pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
}

export default async function api(req: Request): Promise<Response> {
  try {
    const pathname = normalize(new URL(req.url).pathname);
    const method = req.method.toUpperCase();

    for (const [pattern, methods] of routes) {
      const match = pattern.exec(pathname);
      if (!match) continue;

      const handler = methods[method];
      if (!handler) {
        return json({ detail: "Method Not Allowed" }, 405, {
          Allow: Object.keys(methods).join(", "),
        });
      }

      const params = (match.groups ?? {}) as Record<string, string>;
      return await handler(req, params);
    }

    return json({ detail: "Not Found" }, 404);
  } catch (error) {
    if (error instanceof HttpError) {
      return json({ detail: error.detail }, error.status);
    }
    console.error("Unhandled API error:", error);
    return new Response("Internal Server Error", {
      status: 500,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}
