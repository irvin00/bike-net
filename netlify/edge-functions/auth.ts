import type { Config, Context } from "@netlify/edge-functions";

/**
 * HTTP Basic Auth gate for the whole site — static pages, /api/*, and direct
 * function URLs. Edge functions run before rewrites and Functions, so this is
 * the single perimeter check.
 *
 * Configure with two environment variables (locally in .env, in production in
 * Netlify UI → Site configuration → Environment variables):
 *
 *   SITE_AUTH_USER      username (defaults to "admin")
 *   SITE_PASSWORD_HASH  SHA-256 of the password, hex:
 *                       echo -n "your-password" | shasum -a 256
 *
 * The password itself is never stored. Missing or malformed configuration
 * fails closed (503) — the site is never served unprotected by accident.
 */
export const config: Config = { path: "/*" };

const REALM = "Bike View";
const HEX_SHA256 = /^[0-9a-f]{64}$/;

function jsonError(status: number, detail: string, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify({ detail }), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...extra,
    },
  });
}

function unauthorized(): Response {
  return jsonError(401, "Unauthorized", {
    "www-authenticate": `Basic realm="${REALM}", charset="UTF-8"`,
  });
}

function misconfigured(): Response {
  return jsonError(503, "Site authentication is not configured");
}

function decodeBase64Utf8(value: string): string {
  const binary = atob(value);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function timingSafeEqual(a: string, b: string): boolean {
  const aBytes = new TextEncoder().encode(a);
  const bBytes = new TextEncoder().encode(b);
  let diff = aBytes.length ^ bBytes.length;
  const length = Math.max(aBytes.length, bBytes.length);
  for (let i = 0; i < length; i += 1) {
    diff |= (aBytes[i] ?? 0) ^ (bBytes[i] ?? 0);
  }
  return diff === 0;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function parseCredentials(
  header: string | null,
): { user: string; password: string } | null {
  if (!header) return null;

  const parts = header.trim().split(/\s+/);
  if (parts.length !== 2 || parts[0]?.toLowerCase() !== "basic") return null;

  let decoded: string;
  try {
    decoded = decodeBase64Utf8(parts[1] ?? "");
  } catch {
    return null;
  }

  const colon = decoded.indexOf(":");
  if (colon === -1) return null;
  return {
    user: decoded.slice(0, colon),
    password: decoded.slice(colon + 1),
  };
}

export default async function auth(
  request: Request,
  context: Context,
): Promise<Response> {
  const expectedHash = Netlify.env.get("SITE_PASSWORD_HASH")?.trim().toLowerCase();
  if (!expectedHash || !HEX_SHA256.test(expectedHash)) return misconfigured();

  const expectedUser = Netlify.env.get("SITE_AUTH_USER") || "admin";
  const credentials = parseCredentials(request.headers.get("authorization"));
  if (!credentials) return unauthorized();

  const passwordHash = await sha256Hex(credentials.password);
  const userMatches = timingSafeEqual(credentials.user, expectedUser);
  const passwordMatches = timingSafeEqual(passwordHash, expectedHash);
  if (!userMatches || !passwordMatches) return unauthorized();

  return context.next();
}
