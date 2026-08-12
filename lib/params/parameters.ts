/**
 * Named, bounded, provenance-tagged parameters — the shared mechanism behind
 * both `config/risk-default.json` and `config/physiology-default.json`.
 *
 * No imports. Every model config in Valoris uses this so that "no magic
 * numbers" and "everything illustrative until a physician signs it off" are
 * enforced in one place rather than restated per module.
 */

export type SourceStatus =
  | "illustrative"
  | "literature_derived"
  | "expert_proposed"
  | "validated";

export type ClinicalReviewStatus =
  | "unreviewed"
  | "under_review"
  | "approved_for_simulation"
  | "approved_for_pilot"
  | "rejected";

export type ConfigParameter = {
  name: string;
  value: number;
  unit: string;
  sourceStatus: SourceStatus;
  clinicalReviewStatus: ClinicalReviewStatus;
  rationale: string;
  min: number;
  max: number;
  editable: boolean;
  /**
   * Reference into the numbered list in docs/CLINICAL_ASSUMPTIONS.md, e.g.
   * "ref [2]". MANDATORY when `sourceStatus` is `literature_derived` or
   * `validated` — a claim that a value comes from the literature is worthless
   * without pointing at which literature. Honesty rule 8: cite every model, no
   * fabricated references.
   */
  citation?: string;
};

/** Statuses that may not be claimed without a citation. */
const CITATION_REQUIRED: readonly SourceStatus[] = [
  "literature_derived",
  "validated",
];

const SOURCE_STATUSES: readonly SourceStatus[] = [
  "illustrative",
  "literature_derived",
  "expert_proposed",
  "validated",
];

const REVIEW_STATUSES: readonly ClinicalReviewStatus[] = [
  "unreviewed",
  "under_review",
  "approved_for_simulation",
  "approved_for_pilot",
  "rejected",
];

/** Deterministic JSON with object keys sorted, so hashes are stable. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const body = keys
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(record[k])}`)
    .join(",");
  return `{${body}}`;
}

/** FNV-1a, 32-bit, with explicit 32-bit arithmetic. */
function fnv1a32(input: string, offsetBasis: number): number {
  let hash = offsetBasis >>> 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash ^ input.charCodeAt(i)) >>> 0;
    hash =
      (((hash << 24) >>> 0) +
        ((hash << 8) >>> 0) +
        ((hash << 7) >>> 0) +
        ((hash << 4) >>> 0) +
        ((hash << 1) >>> 0) +
        hash) >>>
      0;
  }
  return hash >>> 0;
}

function hex8(n: number): string {
  return (n >>> 0).toString(16).padStart(8, "0");
}

/**
 * Hash of what actually changes behaviour: the model version plus every
 * parameter's numeric value. Not cryptographic — it detects drift, it is not
 * tamper-evident.
 */
export function computeParametersHash(
  modelVersion: string,
  parameters: Record<string, ConfigParameter>,
): string {
  const values: Record<string, number> = {};
  for (const key of Object.keys(parameters)) {
    const p = parameters[key];
    if (p !== undefined) values[key] = p.value;
  }
  const payload = canonicalJson({ modelVersion, values });
  return `${hex8(fnv1a32(payload, 0x811c9dc5))}${hex8(fnv1a32(payload, 0x01000193))}`;
}

export function failConfig(context: string, message: string): never {
  throw new Error(`Invalid ${context}: ${message}`);
}

export function readParameter(
  context: string,
  name: string,
  raw: unknown,
): ConfigParameter {
  const fail = (message: string): never => failConfig(context, message);

  if (raw === null || typeof raw !== "object") {
    fail(`parameter "${name}" must be an object`);
  }
  const r = raw as Record<string, unknown>;

  if (typeof r["value"] !== "number" || !Number.isFinite(r["value"])) {
    fail(`parameter "${name}" needs a finite numeric "value"`);
  }
  if (typeof r["unit"] !== "string") fail(`parameter "${name}" needs a "unit"`);
  if (typeof r["rationale"] !== "string") {
    fail(`parameter "${name}" needs a "rationale"`);
  }
  if (typeof r["min"] !== "number" || typeof r["max"] !== "number") {
    fail(`parameter "${name}" needs numeric "min" and "max"`);
  }
  if (typeof r["editable"] !== "boolean") {
    fail(`parameter "${name}" needs a boolean "editable"`);
  }
  const source = r["sourceStatus"];
  if (!SOURCE_STATUSES.includes(source as SourceStatus)) {
    fail(`parameter "${name}" has an unknown sourceStatus "${String(source)}"`);
  }
  const review = r["clinicalReviewStatus"];
  if (!REVIEW_STATUSES.includes(review as ClinicalReviewStatus)) {
    fail(
      `parameter "${name}" has an unknown clinicalReviewStatus "${String(review)}"`,
    );
  }
  const value = r["value"] as number;
  const min = r["min"] as number;
  const max = r["max"] as number;
  if (value < min || value > max) {
    fail(`parameter "${name}" value ${value} is outside [${min}, ${max}]`);
  }

  const rawCitation = r["citation"];
  if (rawCitation !== undefined && typeof rawCitation !== "string") {
    fail(`parameter "${name}" has a non-string "citation"`);
  }
  const citation =
    typeof rawCitation === "string" && rawCitation.trim() !== ""
      ? rawCitation.trim()
      : undefined;

  if (CITATION_REQUIRED.includes(source as SourceStatus) && citation === undefined) {
    fail(
      `parameter "${name}" claims sourceStatus "${String(source)}" but carries no citation. A literature claim without a reference is not a literature claim.`,
    );
  }

  return {
    name,
    value,
    unit: r["unit"] as string,
    sourceStatus: source as SourceStatus,
    clinicalReviewStatus: review as ClinicalReviewStatus,
    rationale: r["rationale"] as string,
    min,
    max,
    editable: r["editable"] as boolean,
    ...(citation === undefined ? {} : { citation }),
  };
}

export type LoadedParameters<Name extends string> = {
  modelVersion: string;
  configHash: string;
  parameters: Record<Name, ConfigParameter>;
};

/**
 * Parse a raw config object against an exact parameter-name list. Unknown names
 * and missing names both throw, so a typo can never silently fall back to a
 * hidden default.
 */
export function loadNamedParameters<Name extends string>(
  context: string,
  raw: unknown,
  names: readonly Name[],
  /**
   * Parameters owned by a shared config, for quantities used by more than one
   * model. A name may be defined in the shared config OR the local one, never
   * both — shadowing is how two values for one physical quantity drift apart.
   */
  shared?: Record<string, ConfigParameter>,
): LoadedParameters<Name> {
  const fail = (message: string): never => failConfig(context, message);

  if (raw === null || typeof raw !== "object") fail("root must be an object");
  const r = raw as Record<string, unknown>;

  const modelVersion = r["modelVersion"];
  if (typeof modelVersion !== "string" || modelVersion.trim() === "") {
    fail(`"modelVersion" must be a non-empty string`);
  }

  const rawParams = r["parameters"];
  if (rawParams === null || typeof rawParams !== "object") {
    fail(`"parameters" must be an object`);
  }
  const paramsRecord = rawParams as Record<string, unknown>;

  const known = new Set<string>(names);
  for (const key of Object.keys(paramsRecord)) {
    if (!known.has(key)) fail(`unknown parameter "${key}"`);
    if (shared?.[key] !== undefined) {
      fail(
        `parameter "${key}" is owned by the shared config and must not be redefined locally`,
      );
    }
  }

  const parameters = {} as Record<Name, ConfigParameter>;
  for (const name of names) {
    const fromShared = shared?.[name];
    if (fromShared !== undefined) {
      parameters[name] = fromShared;
      continue;
    }
    const entry = paramsRecord[name];
    if (entry === undefined) fail(`missing parameter "${name}"`);
    parameters[name] = readParameter(context, name, entry);
  }

  return {
    modelVersion: modelVersion as string,
    configHash: computeParametersHash(modelVersion as string, parameters),
    parameters,
  };
}
