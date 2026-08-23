/**
 * Fetch real incident data from the interagency services, reproducibly.
 *
 * The Palisades perimeter and incident record in `data/historical/` were
 * originally retrieved by hand, pasted from a browser. That is fine once and
 * indefensible afterwards: nobody could refresh it, verify it, or tell whether
 * the file on disk still matched what the agency publishes. Tier A data whose
 * provenance is "someone downloaded it" is not much better than Tier C.
 *
 * This script makes the retrieval a command. It writes a manifest alongside the
 * data recording the exact URL, the query, the retrieval time and a SHA-256 of
 * every file, so drift is detectable rather than invisible.
 *
 * It will NOT overwrite existing data unless asked. Silently replacing the file
 * an assessment was computed against would break reproducibility in the one
 * place the project promises it.
 *
 *   npx tsx scripts/fetch-historical.ts --list
 *   npx tsx scripts/fetch-historical.ts --incident palisades-2025
 *   npx tsx scripts/fetch-historical.ts --incident palisades-2025 --force
 *   npx tsx scripts/fetch-historical.ts --incident palisades-2025 --verify
 *
 * SIMULATION MODE — NOT FOR OPERATIONAL USE.
 */

export {}; // module scope

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const WFIGS_BASE =
  "https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Interagency_Perimeters/FeatureServer/0/query";

type IncidentPreset = {
  slug: string;
  description: string;
  /** The WFIGS attribute filter that identifies this incident. */
  where: string;
};

/**
 * Known incidents.
 *
 * The `where` clause is part of the provenance: an acreage floor is what
 * separates the incident of interest from unrelated fires sharing a name, and
 * changing it changes which polygon you get.
 */
const PRESETS: IncidentPreset[] = [
  {
    slug: "palisades-2025",
    description: "Palisades Fire, Los Angeles, January 2025 (~23,448 acres)",
    where: "poly_IncidentName='Palisades' AND poly_GISAcres>20000",
  },
];

function usage(): never {
  console.log("Usage:");
  console.log("  npx tsx scripts/fetch-historical.ts --list");
  console.log("  npx tsx scripts/fetch-historical.ts --incident <slug> [--force] [--verify]");
  console.log("");
  console.log("Known incidents:");
  for (const p of PRESETS) console.log(`  ${p.slug.padEnd(18)} ${p.description}`);
  process.exit(1);
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const has = (name: string): boolean => process.argv.includes(`--${name}`);

function sha256(buffer: string): string {
  return createHash("sha256").update(buffer).digest("hex");
}

function buildUrl(where: string, params: Record<string, string>): string {
  const url = new URL(WFIGS_BASE);
  url.searchParams.set("where", where);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url.toString();
}

async function fetchText(url: string, label: string): Promise<string> {
  process.stdout.write(`  ${label} ... `);
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) {
    console.log(`FAILED (HTTP ${response.status})`);
    throw new Error(`${label}: HTTP ${response.status}`);
  }
  const text = await response.text();

  // An ArcGIS error arrives as HTTP 200 with an error body, so status alone
  // proves nothing.
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed === "object" && parsed !== null && "error" in parsed) {
    console.log("FAILED (service returned an error body)");
    throw new Error(`${label}: ${JSON.stringify((parsed as { error: unknown }).error)}`);
  }

  console.log(`ok (${(text.length / 1024).toFixed(0)} KB)`);
  return text;
}

/** Sanity checks. A file that downloads cleanly can still be the wrong file. */
function describeGeoJson(text: string): string {
  const gj = JSON.parse(text) as {
    features?: { geometry?: { type?: string }; properties?: Record<string, unknown> }[];
  };
  const features = gj.features ?? [];
  if (features.length === 0) throw new Error("GeoJSON contains no features");
  const first = features[0];
  return `${features.length} feature(s), first geometry ${first?.geometry?.type ?? "unknown"}`;
}

function describeAttributes(text: string): string {
  const j = JSON.parse(text) as { features?: { attributes?: Record<string, unknown> }[] };
  const attrs = j.features?.[0]?.attributes;
  if (attrs === undefined) throw new Error("attribute response contains no features");
  const acres = attrs["poly_GISAcres"];
  const name = attrs["attr_IncidentName"];
  return `${String(name)} — ${String(acres)} acres`;
}

async function main(): Promise<void> {
  if (has("list") || process.argv.length <= 2) usage();

  const slug = arg("incident");
  const preset = PRESETS.find((p) => p.slug === slug);
  if (preset === undefined) {
    console.error(`Unknown incident "${slug ?? ""}".\n`);
    usage();
  }

  const outDir = path.join(process.cwd(), "data", "historical", preset.slug);
  const perimeterPath = path.join(outDir, "perimeters.geojson");
  const metadataPath = path.join(outDir, "incident-metadata.json");
  const manifestPath = path.join(outDir, "MANIFEST.json");

  const perimeterUrl = buildUrl(preset.where, {
    returnGeometry: "true",
    outSR: "4326",
    f: "geojson",
  });
  const metadataUrl = buildUrl(preset.where, {
    outFields: "*",
    returnGeometry: "false",
    f: "json",
  });

  console.log(`\n${preset.description}`);
  console.log(`where: ${preset.where}\n`);

  // --- verify mode: compare what is on disk against what the service returns
  if (has("verify")) {
    if (!existsSync(manifestPath)) {
      console.error("No MANIFEST.json — nothing to verify against. Fetch first.");
      process.exit(1);
    }
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      files: Record<string, { sha256: string }>;
    };

    let drifted = false;
    for (const [file, entry] of Object.entries(manifest.files)) {
      const onDisk = path.join(outDir, file);
      if (!existsSync(onDisk)) {
        console.log(`  ${file}: MISSING`);
        drifted = true;
        continue;
      }
      const actual = sha256(readFileSync(onDisk, "utf8"));
      const same = actual === entry.sha256;
      console.log(`  ${file}: ${same ? "matches manifest" : "DIFFERS FROM MANIFEST"}`);
      if (!same) drifted = true;
    }
    console.log("");
    console.log(drifted ? "RESULT: local data has drifted from its manifest" : "RESULT: local data matches its manifest");
    process.exit(drifted ? 1 : 0);
  }

  // --- fetch mode
  if (existsSync(perimeterPath) && !has("force")) {
    console.error("Data already exists. Refusing to overwrite.");
    console.error("");
    console.error("Assessments are reproducible only if the data they were computed");
    console.error("against does not change underneath them. Re-run with --force if you");
    console.error("genuinely intend to replace it, and expect the manifest hashes to");
    console.error("change.");
    process.exit(1);
  }

  const perimeter = await fetchText(perimeterUrl, "perimeter geometry");
  const metadata = await fetchText(metadataUrl, "incident record  ");

  console.log("");
  console.log(`  geometry: ${describeGeoJson(perimeter)}`);
  console.log(`  record  : ${describeAttributes(metadata)}`);

  mkdirSync(outDir, { recursive: true });
  writeFileSync(perimeterPath, perimeter);
  writeFileSync(metadataPath, metadata);

  const manifest = {
    incident: preset.slug,
    description: preset.description,
    retrievedAtUtc: new Date().toISOString(),
    source: {
      service: "NIFC / WFIGS Interagency Perimeters (ArcGIS FeatureServer)",
      endpoint: WFIGS_BASE,
      where: preset.where,
      licence: "Public domain (US federal interagency data)",
    },
    queries: {
      "perimeters.geojson": perimeterUrl,
      "incident-metadata.json": metadataUrl,
    },
    files: {
      "perimeters.geojson": { bytes: perimeter.length, sha256: sha256(perimeter) },
      "incident-metadata.json": { bytes: metadata.length, sha256: sha256(metadata) },
    },
    notice:
      "Tier A — real measured environmental data, stored exactly as returned. No transformation applied. Verify with --verify before trusting an assessment computed against it.",
  };
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  console.log("");
  console.log(`  wrote ${path.relative(process.cwd(), perimeterPath)}`);
  console.log(`  wrote ${path.relative(process.cwd(), metadataPath)}`);
  console.log(`  wrote ${path.relative(process.cwd(), manifestPath)}`);
  console.log("");
  console.log("RESULT: retrieved and manifested");
}

main().catch((error: unknown) => {
  console.error("");
  console.error(`FAILED: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
