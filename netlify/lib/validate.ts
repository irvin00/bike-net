/**
 * Hand-rolled request validators mirroring the Pydantic models and the
 * import's cross-reference checks. Error strings are the app's own, not
 * Pydantic's formatted arrays: api.js shows `detail` verbatim, so the ones
 * users actually see (e.g. "Label is required") are reproduced exactly.
 */
import { HttpError, type JsonObject } from "./http.js";

// --- Primitives ---

export function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function has(obj: JsonObject, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function wrong(path: string, message: string): never {
  throw new HttpError(422, `${path}: ${message}`);
}

const STRING = "Input should be a valid string";
const INTEGER = "Input should be a valid integer";
const NUMBER = "Input should be a valid number";
const BOOLEAN = "Input should be a valid boolean";
const LIST = "Input should be a valid list";
const DICT = "Input should be a valid dictionary or object to extract fields from";
const FIELD_REQUIRED = "Field required";

function requiredString(obj: JsonObject, key: string): string {
  if (!has(obj, key)) wrong(key, FIELD_REQUIRED);
  const value = obj[key];
  if (typeof value !== "string") wrong(key, STRING);
  return value;
}

function stringOr(obj: JsonObject, key: string, fallback: string): string {
  if (!has(obj, key)) return fallback;
  const value = obj[key];
  if (typeof value !== "string") wrong(key, STRING);
  return value;
}

function nullableStringOr(
  obj: JsonObject,
  key: string,
  fallback: string | null,
): string | null {
  if (!has(obj, key)) return fallback;
  const value = obj[key];
  if (value === null) return null;
  if (typeof value !== "string") wrong(key, STRING);
  return value;
}

function numberOrNull(obj: JsonObject, key: string): number | null {
  if (!has(obj, key)) return null;
  const value = obj[key];
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) wrong(key, NUMBER);
  return value;
}

function statusValue(value: unknown, path: string): string {
  if (value !== "active" && value !== "former") {
    wrong(path, "Input should be 'active' or 'former'");
  }
  return value;
}

// --- Bikes ---

export interface BikeCreate {
  name: string;
  description: string;
  full_story: string;
  status: string;
  acquired_on: string | null;
  retired_on: string | null;
}

export function parseBikeCreate(body: JsonObject): BikeCreate {
  return {
    name: requiredString(body, "name"),
    description: stringOr(body, "description", ""),
    full_story: stringOr(body, "full_story", ""),
    status: has(body, "status") ? statusValue(body.status, "status") : "active",
    acquired_on: nullableStringOr(body, "acquired_on", null),
    retired_on: nullableStringOr(body, "retired_on", null),
  };
}

/** Only present keys are returned, matching model_dump(exclude_unset=True). */
export interface BikeUpdate {
  name?: string;
  description?: string;
  full_story?: string;
  status?: string;
  acquired_on?: string | null;
  retired_on?: string | null;
}

export function parseBikeUpdate(body: JsonObject): BikeUpdate {
  const updates: BikeUpdate = {};
  if (has(body, "name")) updates.name = requiredString(body, "name");
  if (has(body, "description")) updates.description = requiredString(body, "description");
  if (has(body, "full_story")) updates.full_story = requiredString(body, "full_story");
  if (has(body, "status")) updates.status = statusValue(body.status, "status");
  if (has(body, "acquired_on")) updates.acquired_on = nullableStringOr(body, "acquired_on", null);
  if (has(body, "retired_on")) updates.retired_on = nullableStringOr(body, "retired_on", null);
  return updates;
}

// --- Pills ---

export interface PillCreate {
  label: string;
  color: string;
}

export function parsePillCreate(body: JsonObject): PillCreate {
  return {
    label: requiredString(body, "label"),
    color: stringOr(body, "color", "#6b7280"),
  };
}

export function parsePillSet(body: JsonObject): number[] {
  if (!has(body, "pill_ids")) wrong("pill_ids", FIELD_REQUIRED);
  const value = body.pill_ids;
  if (!Array.isArray(value)) wrong("pill_ids", LIST);
  return value.map((item, i) => {
    if (typeof item !== "number" || !Number.isInteger(item)) {
      wrong(`pill_ids.${i}`, INTEGER);
    }
    return item;
  });
}

// --- Maintenance ---

export interface MaintenanceCreate {
  date: string;
  description: string;
  cost: number | null;
}

export function parseMaintenanceCreate(body: JsonObject): MaintenanceCreate {
  return {
    date: requiredString(body, "date"),
    description: requiredString(body, "description"),
    cost: numberOrNull(body, "cost"),
  };
}

export interface MaintenanceUpdate {
  date?: string;
  description?: string;
  cost?: number | null;
}

export function parseMaintenanceUpdate(body: JsonObject): MaintenanceUpdate {
  const updates: MaintenanceUpdate = {};
  if (has(body, "date")) updates.date = requiredString(body, "date");
  if (has(body, "description")) updates.description = requiredString(body, "description");
  if (has(body, "cost")) updates.cost = numberOrNull(body, "cost");
  return updates;
}

// --- Images ---

export interface ImageUpdate {
  is_primary?: boolean;
  sort_order?: number;
}

export function parseImageUpdate(body: JsonObject): ImageUpdate {
  const updates: ImageUpdate = {};
  if (has(body, "is_primary")) {
    const value = body.is_primary;
    if (value === null) {
      // Pydantic accepts None here (Optional[bool]); it is a no-op.
    } else if (typeof value !== "boolean") {
      wrong("is_primary", BOOLEAN);
    } else {
      updates.is_primary = value;
    }
  }
  if (has(body, "sort_order")) {
    const value = body.sort_order;
    if (typeof value !== "number" || !Number.isInteger(value)) {
      wrong("sort_order", INTEGER);
    }
    updates.sort_order = value;
  }
  return updates;
}

// --- Import (bike_view.json restore) ---

export interface ImportPill {
  id: number;
  label: string;
  color: string;
}

export interface ImportPillRef {
  id: number;
}

export interface ImportImage {
  bike_id: number | null;
  filename: string;
  original_name: string;
  is_primary: boolean;
  sort_order: number;
}

export interface ImportMaintenance {
  bike_id: number | null;
  date: string;
  description: string;
  cost: number | null;
}

export interface ImportBike {
  id: number;
  name: string;
  description: string;
  full_story: string;
  status: string;
  acquired_on: string | null;
  retired_on: string | null;
  created_at: string | null;
  updated_at: string | null;
  pills: ImportPillRef[];
  images: ImportImage[];
  maintenance_records: ImportMaintenance[];
}

export interface ImportPayload {
  pills: ImportPill[];
  bikes: ImportBike[];
}

/** Collect up to 3 structural issues, matching Pydantic's error cap. */
class Issues {
  private items: string[] = [];

  add(path: string, message: string): void {
    if (this.items.length < 3) this.items.push(`${path}: ${message}`);
  }

  throwIfAny(): void {
    if (this.items.length > 0) {
      throw new HttpError(
        422,
        `Invalid export file: ${this.items.join("; ")}`,
      );
    }
  }
}

type AnyObj = Record<string, unknown>;

function objectAt(value: unknown, path: string, issues: Issues): AnyObj | null {
  if (!isObject(value)) {
    issues.add(path, DICT);
    return null;
  }
  return value;
}

function arrayAt(value: unknown, path: string, issues: Issues): unknown[] | null {
  if (!Array.isArray(value)) {
    issues.add(path, LIST);
    return null;
  }
  return value;
}

/** Required string field. Returns "" while an issue is pending (unused then). */
function reqString(obj: AnyObj, key: string, path: string, issues: Issues): string {
  const full = `${path}.${key}`;
  if (!has(obj, key)) {
    issues.add(full, FIELD_REQUIRED);
    return "";
  }
  const value = obj[key];
  if (typeof value !== "string") {
    issues.add(full, STRING);
    return "";
  }
  return value;
}

function defString(
  obj: AnyObj,
  key: string,
  path: string,
  issues: Issues,
  fallback: string,
): string {
  if (!has(obj, key)) return fallback;
  const value = obj[key];
  if (typeof value !== "string") {
    issues.add(`${path}.${key}`, STRING);
    return fallback;
  }
  return value;
}

function optString(
  obj: AnyObj,
  key: string,
  path: string,
  issues: Issues,
): string | null {
  if (!has(obj, key)) return null;
  const value = obj[key];
  if (value === null) return null;
  if (typeof value !== "string") {
    issues.add(`${path}.${key}`, STRING);
    return null;
  }
  return value;
}

function reqInt(obj: AnyObj, key: string, path: string, issues: Issues): number {
  const full = `${path}.${key}`;
  if (!has(obj, key)) {
    issues.add(full, FIELD_REQUIRED);
    return 0;
  }
  const value = obj[key];
  if (typeof value !== "number" || !Number.isInteger(value)) {
    issues.add(full, INTEGER);
    return 0;
  }
  return value;
}

function optInt(
  obj: AnyObj,
  key: string,
  path: string,
  issues: Issues,
  fallback: number | null,
): number | null {
  if (!has(obj, key)) return fallback;
  const value = obj[key];
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isInteger(value)) {
    issues.add(`${path}.${key}`, INTEGER);
    return fallback;
  }
  return value;
}

/** Pydantic bool accepts true/false and 0/1 (the SQLite export uses 0/1). */
function defBool(
  obj: AnyObj,
  key: string,
  path: string,
  issues: Issues,
  fallback: boolean,
): boolean {
  if (!has(obj, key)) return fallback;
  const value = obj[key];
  if (typeof value === "boolean") return value;
  if (value === 0) return false;
  if (value === 1) return true;
  issues.add(`${path}.${key}`, BOOLEAN);
  return fallback;
}

function optFloat(
  obj: AnyObj,
  key: string,
  path: string,
  issues: Issues,
): number | null {
  if (!has(obj, key)) return null;
  const value = obj[key];
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    issues.add(`${path}.${key}`, NUMBER);
    return null;
  }
  return value;
}

function parsePillPayload(value: unknown, path: string, issues: Issues): ImportPill {
  const obj = objectAt(value, path, issues) ?? {};
  return {
    id: reqInt(obj, "id", path, issues),
    label: reqString(obj, "label", path, issues),
    color: defString(obj, "color", path, issues, "#6b7280"),
  };
}

function parsePillRef(value: unknown, path: string, issues: Issues): ImportPillRef {
  const obj = objectAt(value, path, issues) ?? {};
  return { id: reqInt(obj, "id", path, issues) };
}

function parseImagePayload(
  value: unknown,
  path: string,
  issues: Issues,
): ImportImage {
  const obj = objectAt(value, path, issues) ?? {};
  return {
    bike_id: optInt(obj, "bike_id", path, issues, null),
    filename: reqString(obj, "filename", path, issues),
    original_name: defString(obj, "original_name", path, issues, ""),
    is_primary: defBool(obj, "is_primary", path, issues, false),
    sort_order: optInt(obj, "sort_order", path, issues, 0) ?? 0,
  };
}

function parseMaintenancePayload(
  value: unknown,
  path: string,
  issues: Issues,
): ImportMaintenance {
  const obj = objectAt(value, path, issues) ?? {};
  return {
    bike_id: optInt(obj, "bike_id", path, issues, null),
    date: reqString(obj, "date", path, issues),
    description: reqString(obj, "description", path, issues),
    cost: optFloat(obj, "cost", path, issues),
  };
}

function parseBikePayload(value: unknown, path: string, issues: Issues): ImportBike {
  const obj = objectAt(value, path, issues) ?? {};
  const pills = has(obj, "pills")
    ? arrayAt(obj.pills, `${path}.pills`, issues) ?? []
    : [];
  const images = has(obj, "images")
    ? arrayAt(obj.images, `${path}.images`, issues) ?? []
    : [];
  const maintenance = has(obj, "maintenance_records")
    ? arrayAt(obj.maintenance_records, `${path}.maintenance_records`, issues) ?? []
    : [];

  return {
    id: reqInt(obj, "id", path, issues),
    name: reqString(obj, "name", path, issues),
    description: defString(obj, "description", path, issues, ""),
    full_story: defString(obj, "full_story", path, issues, ""),
    status: has(obj, "status")
      ? (() => {
          const raw = obj.status;
          if (raw !== "active" && raw !== "former") {
            issues.add(`${path}.status`, "Input should be 'active' or 'former'");
            return "active";
          }
          return raw;
        })()
      : "active",
    acquired_on: optString(obj, "acquired_on", path, issues),
    retired_on: optString(obj, "retired_on", path, issues),
    created_at: optString(obj, "created_at", path, issues),
    updated_at: optString(obj, "updated_at", path, issues),
    pills: pills.map((p, i) => parsePillRef(p, `${path}.pills.${i}`, issues)),
    images: images.map((img, i) => parseImagePayload(img, `${path}.images.${i}`, issues)),
    maintenance_records: maintenance.map((rec, i) =>
      parseMaintenancePayload(rec, `${path}.maintenance_records.${i}`, issues),
    ),
  };
}

/**
 * Validate an export document structurally, then cross-check references.
 * Returns the normalized payload (pill labels trimmed) or throws 422.
 */
export function parseImportPayload(payload: unknown): ImportPayload {
  const issues = new Issues();
  const root = objectAt(payload, "root", issues);

  let pills: ImportPill[] = [];
  let bikes: ImportBike[] = [];

  if (root) {
    if (!has(root, "pills")) {
      issues.add("pills", FIELD_REQUIRED);
    } else {
      const rawPills = arrayAt(root.pills, "pills", issues);
      if (rawPills) {
        pills = rawPills.map((p, i) => parsePillPayload(p, `pills.${i}`, issues));
      }
    }

    if (!has(root, "bikes")) {
      issues.add("bikes", FIELD_REQUIRED);
    } else {
      const rawBikes = arrayAt(root.bikes, "bikes", issues);
      if (rawBikes) {
        bikes = rawBikes.map((b, i) => parseBikePayload(b, `bikes.${i}`, issues));
      }
    }
  }

  issues.throwIfAny();

  // --- Cross-reference validation (pure, before any DB write) ---

  const pillIds = new Set<number>();
  const pillLabels = new Set<string>();
  for (const pill of pills) {
    const label = pill.label.trim();
    if (!label) {
      throw new HttpError(422, `Pill ${pill.id}: label must not be empty`);
    }
    if (pillIds.has(pill.id)) {
      throw new HttpError(422, `Duplicate pill id ${pill.id}`);
    }
    if (pillLabels.has(label)) {
      throw new HttpError(422, `Duplicate pill label '${label}'`);
    }
    pillIds.add(pill.id);
    pillLabels.add(label);
    pill.label = label; // insert the stripped value
  }

  const bikeIds = new Set<number>();
  for (const bike of bikes) {
    if (bikeIds.has(bike.id)) {
      throw new HttpError(422, `Duplicate bike id ${bike.id}`);
    }
    bikeIds.add(bike.id);

    for (const ref of bike.pills) {
      if (!pillIds.has(ref.id)) {
        throw new HttpError(
          422,
          `Bike ${bike.id} references unknown pill id ${ref.id}`,
        );
      }
    }

    let primaries = 0;
    for (const img of bike.images) {
      if (
        !img.filename ||
        img.filename.includes("/") ||
        img.filename.includes("\\") ||
        img.filename.includes("..")
      ) {
        throw new HttpError(
          422,
          `Bike ${bike.id}: unsafe image filename '${img.filename}'`,
        );
      }
      if (img.bike_id !== null && img.bike_id !== bike.id) {
        throw new HttpError(
          422,
          `Bike ${bike.id}: image bike_id ${img.bike_id} does not match`,
        );
      }
      if (img.is_primary) primaries += 1;
    }
    if (primaries > 1) {
      throw new HttpError(422, `Bike ${bike.id}: more than one primary image`);
    }

    for (const rec of bike.maintenance_records) {
      if (rec.bike_id !== null && rec.bike_id !== bike.id) {
        throw new HttpError(
          422,
          `Bike ${bike.id}: maintenance bike_id ${rec.bike_id} does not match`,
        );
      }
    }
  }

  return { pills, bikes };
}
