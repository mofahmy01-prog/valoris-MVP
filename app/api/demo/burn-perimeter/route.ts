/**
 * The real NIFC Palisades burn perimeter — Tier A.
 *
 * Served once and cached by the client rather than repeated on every 2-second
 * poll: it is a 377 KB MultiPolygon and does not change.
 *
 * This is the REAL final burn footprint. It is not a time series and cannot
 * show the fire growing; the animated front is a separate, simulated layer and
 * is labelled as such. See data/historical/palisades-2025/README.md.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type Ring = number[][];

/** Douglas-Peucker-lite: drop points closer than `toleranceDeg` to the last kept. */
function thin(ring: Ring, toleranceDeg: number): Ring {
  if (ring.length < 3) return ring;
  const out: Ring = [];
  let last: number[] | null = null;
  for (const point of ring) {
    if (
      last === null ||
      Math.abs(point[0]! - last[0]!) > toleranceDeg ||
      Math.abs(point[1]! - last[1]!) > toleranceDeg
    ) {
      out.push(point);
      last = point;
    }
  }
  const first = ring[0];
  if (first !== undefined) out.push(first);
  return out;
}

export async function GET() {
  try {
    const raw = readFileSync(
      join(process.cwd(), "data", "historical", "palisades-2025", "perimeters.geojson"),
      "utf8",
    );
    const gj = JSON.parse(raw) as {
      features?: Array<{
        geometry?: { type?: string; coordinates?: unknown };
        properties?: Record<string, unknown>;
      }>;
    };

    const rings: Ring[] = [];
    for (const feature of gj.features ?? []) {
      const geometry = feature.geometry;
      if (geometry?.type === "MultiPolygon" && Array.isArray(geometry.coordinates)) {
        for (const polygon of geometry.coordinates as Ring[][]) {
          const outer = polygon[0];
          if (Array.isArray(outer) && outer.length >= 4) rings.push(outer);
        }
      } else if (geometry?.type === "Polygon" && Array.isArray(geometry.coordinates)) {
        const outer = (geometry.coordinates as Ring[])[0];
        if (Array.isArray(outer) && outer.length >= 4) rings.push(outer);
      }
    }

    // Keep only substantial rings, thinned for the wire. ~11 m tolerance.
    const simplified = rings
      .filter((r) => r.length >= 8)
      .map((r) => thin(r, 0.0001))
      .filter((r) => r.length >= 4);

    return NextResponse.json({
      type: "Feature",
      properties: {
        source: "NIFC / WFIGS Interagency Perimeters",
        incident: "PALISADES",
        retrievedAt: "2026-08-14",
        dataTier: "A_REAL_ENVIRONMENTAL",
        isSimulated: false,
        licence: "Public domain (US federal interagency data)",
        note: "Real final burn footprint, January 2025. Not a time series — it cannot show the fire growing. Crew positions and physiology in this demo are simulated.",
        ringCount: simplified.length,
      },
      geometry: { type: "MultiPolygon", coordinates: simplified.map((r) => [r]) },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "perimeter_unavailable",
        message:
          error instanceof Error ? error.message : "could not read the perimeter fixture",
        hint: "data/historical/palisades-2025/perimeters.geojson is missing — see that directory's README for the exact NIFC query.",
      },
      { status: 404 },
    );
  }
}
