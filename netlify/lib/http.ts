/**
 * HTTP primitives shared by the API function and every route module.
 * Error contract matches FastAPI: thrown HttpErrors become
 * `{"detail": "..."}` with the given status, which api.js surfaces verbatim.
 */

export class HttpError extends Error {
  readonly status: number;
  readonly detail: string;

  constructor(status: number, detail: string) {
    super(detail);
    this.name = "HttpError";
    this.status = status;
    this.detail = detail;
  }
}

export function json(
  data: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

export function noContent(): Response {
  return new Response(null, { status: 204 });
}

export type JsonObject = Record<string, unknown>;

/** Parse a JSON request body. FastAPI would 422 on malformed JSON. */
export async function readJsonBody(req: Request): Promise<JsonObject> {
  const text = await req.text();
  if (!text.trim()) return {};
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new HttpError(422, "Invalid JSON body");
  }
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw new HttpError(422, "Invalid JSON body");
  }
  return payload as JsonObject;
}

/** Parse multipart/form-data, mapping parser failures to a 400. */
export async function readFormData(req: Request): Promise<FormData> {
  try {
    return await req.formData();
  } catch {
    throw new HttpError(400, "Invalid form data");
  }
}

/** All File parts for a field (string parts are ignored). */
export function getFiles(form: FormData, key: string): File[] {
  const files: File[] = [];
  for (const value of form.getAll(key)) {
    if (typeof value !== "string") files.push(value);
  }
  return files;
}

/** A text field, or null when absent / sent as a file part. */
export function getText(form: FormData, key: string): string | null {
  const value = form.get(key);
  return typeof value === "string" ? value : null;
}
