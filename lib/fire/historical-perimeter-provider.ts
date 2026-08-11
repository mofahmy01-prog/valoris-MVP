/**
 * HistoricalPerimeterProvider — reads real observed fire perimeters from a
 * GeoJSON file the operator supplies.
 *
 * This provider does NOT call any remote service. Valoris ships no NIFC API
 * client, because inventing a vendor integration is forbidden and because the
 * honest workflow for a prototype is: download a published perimeter dataset,
 * point Valoris at the file.
 *
 * Where to get the data (public, open):
 *   NIFC Open Data — Wildland Fire Perimeters
 *   https://data-nifc.opendata.arcgis.com/
 *   Export as GeoJSON and save the file, then set VALORIS_PERIMETER_GEOJSON to
 *   its path, or pass a path to the constructor.
 *
 * No perimeter data is bundled with this repository. If the file is absent the
 * provider reports itself unavailable and says why — it never substitutes
 * invented geometry for real data.
 *
 * Because these are OBSERVED perimeters, `isFireBehaviourPrediction` is true
 * only in the sense that the geometry came from a real source rather than from
 * Valoris. The provider never extrapolates: asked for a future time, it returns
 * the most recent perimeter at or before that time and drops confidence.
 */

import { readFileSync } from "node:fs";

import {
  FireFrontUnavailableError,
  type FireFront,
  type FireFrontConfidence,
  type FireFrontProvider,
  type FireFrontProviderKey,
  type FireFrontQuery,
  type LatLng,
} from "./types";

/** Beyond this age, an observed perimeter is no longer treated as current. */
const STALE_PERIMETER_MS = 6 * 60 * 60 * 1000;

type PerimeterSnapshot = {
  observedAtMs: number;
  ring: LatLng[];
  sourceLabel: string;
};

type GeoJsonPosition = [number, number, ...number[]];

function parsePositionRing(raw: unknown): LatLng[] {
  if (!Array.isArray(raw)) return [];
  const ring: LatLng[] = [];
  for (const entry of raw) {
    if (!Array.isArray(entry) || entry.length < 2) continue;
    const [lng, lat] = entry as GeoJsonPosition;
    if (typeof lng !== "number" || typeof lat !== "number") continue;
    ring.push({ lat, lng });
  }
  // GeoJSON closes rings by repeating the first point; our FireFront does not.
  if (ring.length > 1) {
    const first = ring[0] as LatLng;
    const last = ring[ring.length - 1] as LatLng;
    if (first.lat === last.lat && first.lng === last.lng) ring.pop();
  }
  return ring;
}

/** Largest ring in a Polygon or MultiPolygon — the outer perimeter. */
function largestRing(geometry: unknown): LatLng[] {
  if (geometry === null || typeof geometry !== "object") return [];
  const g = geometry as { type?: unknown; coordinates?: unknown };

  if (g.type === "Polygon" && Array.isArray(g.coordinates)) {
    return parsePositionRing(g.coordinates[0]);
  }
  if (g.type === "MultiPolygon" && Array.isArray(g.coordinates)) {
    let best: LatLng[] = [];
    for (const polygon of g.coordinates) {
      if (!Array.isArray(polygon)) continue;
      const ring = parsePositionRing(polygon[0]);
      if (ring.length > best.length) best = ring;
    }
    return best;
  }
  return [];
}

function readTimestampMs(properties: Record<string, unknown>): number | null {
  // NIFC perimeter exports vary between products; accept the common keys and
  // fall back to null rather than guessing.
  const candidates = [
    "poly_DateCurrent",
    "attr_FireDiscoveryDateTime",
    "CreateDate",
    "DateCurrent",
    "observedAt",
    "timestamp",
  ];
  for (const key of candidates) {
    const value = properties[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
      const parsed = Date.parse(value);
      if (!Number.isNaN(parsed)) return parsed;
    }
  }
  return null;
}

export class HistoricalPerimeterProvider implements FireFrontProvider {
  readonly key: FireFrontProviderKey = "historical_perimeter";
  readonly label = "Historical observed perimeter (operator-supplied GeoJSON)";

  private readonly filePath: string | undefined;
  private snapshots: PerimeterSnapshot[] | null = null;
  private loadError: string | null = null;

  constructor(filePath?: string) {
    this.filePath = filePath ?? process.env["VALORIS_PERIMETER_GEOJSON"];
  }

  /** Parse a GeoJSON FeatureCollection into time-ordered perimeter snapshots. */
  static parse(geojson: unknown, sourceLabel: string): PerimeterSnapshot[] {
    if (geojson === null || typeof geojson !== "object") return [];
    const root = geojson as { type?: unknown; features?: unknown };
    const features = Array.isArray(root.features) ? root.features : [];

    const snapshots: PerimeterSnapshot[] = [];
    features.forEach((feature, index) => {
      if (feature === null || typeof feature !== "object") return;
      const f = feature as { geometry?: unknown; properties?: unknown };
      const ring = largestRing(f.geometry);
      if (ring.length < 3) return;
      const properties =
        f.properties !== null && typeof f.properties === "object"
          ? (f.properties as Record<string, unknown>)
          : {};
      const observedAtMs = readTimestampMs(properties);
      snapshots.push({
        // Features with no usable timestamp are ordered by file position, which
        // is recorded in the provenance string so nobody mistakes it for time.
        observedAtMs: observedAtMs ?? index,
        ring,
        sourceLabel:
          observedAtMs === null
            ? `${sourceLabel} (feature ${index}, no timestamp in properties)`
            : `${sourceLabel} (feature ${index})`,
      });
    });

    return snapshots.sort((a, b) => a.observedAtMs - b.observedAtMs);
  }

  private load(): PerimeterSnapshot[] | null {
    if (this.snapshots !== null || this.loadError !== null) return this.snapshots;
    if (this.filePath === undefined || this.filePath.trim() === "") {
      this.loadError =
        "No perimeter file configured. Download a GeoJSON perimeter export from NIFC Open Data (https://data-nifc.opendata.arcgis.com/) and set VALORIS_PERIMETER_GEOJSON to its path. Valoris bundles no perimeter data and will not substitute invented geometry.";
      return null;
    }
    try {
      const raw = readFileSync(this.filePath, "utf8");
      const parsed = HistoricalPerimeterProvider.parse(
        JSON.parse(raw) as unknown,
        this.filePath,
      );
      if (parsed.length === 0) {
        this.loadError = `No usable Polygon or MultiPolygon features found in ${this.filePath}.`;
        return null;
      }
      this.snapshots = parsed;
      return parsed;
    } catch (error) {
      this.loadError = `Could not read ${this.filePath}: ${
        error instanceof Error ? error.message : String(error)
      }`;
      return null;
    }
  }

  isAvailable(): boolean {
    return this.load() !== null;
  }

  unavailableReason(): string {
    this.load();
    return this.loadError ?? "";
  }

  async getFireFront(query: FireFrontQuery): Promise<FireFront> {
    const snapshots = this.load();
    if (snapshots === null) {
      throw new FireFrontUnavailableError(this.key, this.unavailableReason());
    }

    // Most recent perimeter at or before the requested time; if the request
    // predates every perimeter, use the earliest and say so.
    let chosen = snapshots[0] as PerimeterSnapshot;
    for (const snapshot of snapshots) {
      if (snapshot.observedAtMs <= query.atMs) chosen = snapshot;
      else break;
    }

    const ageMs = query.atMs - chosen.observedAtMs;
    const isProjection = query.atMs > query.nowMs;

    let confidence: FireFrontConfidence;
    if (isProjection) {
      // This provider does not extrapolate. A future request gets the last
      // observed perimeter, which is not a prediction of where the fire will be.
      confidence = "unknown";
    } else if (ageMs < 0) {
      confidence = "unknown";
    } else if (ageMs <= STALE_PERIMETER_MS) {
      confidence = "high";
    } else {
      confidence = "low";
    }

    const provenanceParts = [
      `Observed perimeter from ${chosen.sourceLabel}.`,
      `Perimeter timestamp ${new Date(chosen.observedAtMs).toISOString()}, requested ${new Date(query.atMs).toISOString()}.`,
    ];
    if (isProjection) {
      provenanceParts.push(
        "This provider does not extrapolate. The last observed perimeter is shown for a future time; it is NOT a prediction of future fire position.",
      );
    } else if (ageMs > STALE_PERIMETER_MS) {
      provenanceParts.push(
        `Perimeter is ${Math.round(ageMs / 3_600_000)} h old and may no longer reflect the fire.`,
      );
    }

    return {
      providerKey: this.key,
      providerLabel: this.label,
      validAtMs: query.atMs,
      perimeter: chosen.ring,
      confidence,
      // Real observed geometry, not something Valoris drew.
      isFireBehaviourPrediction: true,
      provenance: provenanceParts.join(" "),
      isProjection,
    };
  }
}
