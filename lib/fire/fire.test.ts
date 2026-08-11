import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { FarsiteAdapter } from "./farsite-adapter";
import { GeometricSpreadProvider } from "./geometric-spread-provider";
import { distanceToPerimeterM, haversineMetres, isInsidePerimeter, offsetMetres } from "./geometry";
import { HistoricalPerimeterProvider } from "./historical-perimeter-provider";
import { createFireFrontProvider, listFireFrontProviders } from "./registry";
import { FireFrontUnavailableError, type FireFrontQuery } from "./types";

const ORIGIN = { lat: 37.35, lng: -122.05 };
const NOW_MS = 1_700_000_000_000;

function query(overrides: Partial<FireFrontQuery> = {}): FireFrontQuery {
  return {
    atMs: NOW_MS,
    nowMs: NOW_MS,
    origin: ORIGIN,
    windSpeedMs: 8,
    windDirDeg: 270, // wind from the west, so the head runs east
    elapsedMs: 10 * 60_000,
    ...overrides,
  };
}

describe("geometry", () => {
  it("measures a known distance", () => {
    const oneKmNorth = offsetMetres(ORIGIN, 0, 1000);
    expect(haversineMetres(ORIGIN, oneKmNorth)).toBeCloseTo(1000, 0);
  });

  it("treats a point inside the perimeter as zero separation", () => {
    const square = [
      offsetMetres(ORIGIN, -500, -500),
      offsetMetres(ORIGIN, 500, -500),
      offsetMetres(ORIGIN, 500, 500),
      offsetMetres(ORIGIN, -500, 500),
    ];
    expect(isInsidePerimeter(ORIGIN, square)).toBe(true);
    // Never report positive separation for someone inside the fire area.
    expect(distanceToPerimeterM(ORIGIN, square)).toBe(0);
  });

  it("measures distance to the nearest edge from outside", () => {
    const square = [
      offsetMetres(ORIGIN, -500, -500),
      offsetMetres(ORIGIN, 500, -500),
      offsetMetres(ORIGIN, 500, 500),
      offsetMetres(ORIGIN, -500, 500),
    ];
    const point = offsetMetres(ORIGIN, 800, 0); // 300 m east of the edge
    expect(distanceToPerimeterM(point, square)).toBeCloseTo(300, -1);
  });

  it("reports infinite separation when there is no perimeter", () => {
    expect(distanceToPerimeterM(ORIGIN, [])).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("GeometricSpreadProvider", () => {
  const provider = new GeometricSpreadProvider();

  it("never claims to be a fire behaviour prediction", async () => {
    const front = await provider.getFireFront(query());
    expect(front.isFireBehaviourPrediction).toBe(false);
    expect(front.provenance).toContain("Not a fire behaviour prediction");
    expect(front.provenance.toLowerCase()).toContain("placeholder");
  });

  it("never reports better than low confidence", async () => {
    for (const elapsedMs of [0, 60_000, 30 * 60_000]) {
      const front = await provider.getFireFront(query({ elapsedMs }));
      expect(front.confidence).toBe("low");
    }
  });

  it("is deterministic", async () => {
    const a = await provider.getFireFront(query());
    const b = await provider.getFireFront(query());
    expect(a).toEqual(b);
  });

  it("grows over time", async () => {
    const early = provider.getFireFrontSync(query({ elapsedMs: 0 }));
    const later = provider.getFireFrontSync(query({ elapsedMs: 20 * 60_000 }));
    const point = offsetMetres(ORIGIN, 2000, 0);
    expect(distanceToPerimeterM(point, later.perimeter)).toBeLessThan(
      distanceToPerimeterM(point, early.perimeter),
    );
  });

  it("advances downwind, not upwind", async () => {
    // Wind from the west (270) drives the head east.
    const front = provider.getFireFrontSync(
      query({ windDirDeg: 270, windSpeedMs: 12, elapsedMs: 30 * 60_000 }),
    );
    const eastPoint = offsetMetres(ORIGIN, 1500, 0);
    const westPoint = offsetMetres(ORIGIN, -1500, 0);
    expect(distanceToPerimeterM(eastPoint, front.perimeter)).toBeLessThan(
      distanceToPerimeterM(westPoint, front.perimeter),
    );
  });

  it("marks a future request as a projection", async () => {
    const front = await provider.getFireFront(
      query({ atMs: NOW_MS + 15 * 60_000 }),
    );
    expect(front.isProjection).toBe(true);
    const present = await provider.getFireFront(query());
    expect(present.isProjection).toBe(false);
  });
});

describe("FarsiteAdapter", () => {
  it("is never available and says why", () => {
    const adapter = new FarsiteAdapter();
    expect(adapter.isAvailable()).toBe(false);
    expect(adapter.unavailableReason()).toContain("Not implemented");
  });

  it("stays unavailable even when a source is configured", () => {
    const adapter = new FarsiteAdapter({ perimeterSourceUri: "s3://example/run" });
    expect(adapter.isAvailable()).toBe(false);
    expect(adapter.unavailableReason()).toContain("no FARSITE perimeter parser");
  });

  it("throws rather than inventing a front", async () => {
    const adapter = new FarsiteAdapter();
    await expect(adapter.getFireFront(query())).rejects.toBeInstanceOf(
      FireFrontUnavailableError,
    );
  });
});

describe("HistoricalPerimeterProvider", () => {
  it("is unavailable with no file, and points at the real data source", () => {
    const provider = new HistoricalPerimeterProvider("");
    expect(provider.isAvailable()).toBe(false);
    expect(provider.unavailableReason()).toContain("data-nifc.opendata.arcgis.com");
    expect(provider.unavailableReason()).toContain("will not substitute invented geometry");
  });

  it("reports a missing file rather than falling back", () => {
    const provider = new HistoricalPerimeterProvider(
      join(process.cwd(), "does-not-exist.geojson"),
    );
    expect(provider.isAvailable()).toBe(false);
    expect(provider.unavailableReason()).toContain("Could not read");
  });

  it("parses Polygon features and closes the ring", () => {
    const geojson = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: { poly_DateCurrent: "2026-08-01T12:00:00Z" },
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [-122.06, 37.34],
                [-122.04, 37.34],
                [-122.04, 37.36],
                [-122.06, 37.36],
                [-122.06, 37.34],
              ],
            ],
          },
        },
      ],
    };
    const snapshots = HistoricalPerimeterProvider.parse(geojson, "test");
    expect(snapshots).toHaveLength(1);
    // GeoJSON repeats the closing point; our FireFront does not.
    expect(snapshots[0]?.ring).toHaveLength(4);
    expect(snapshots[0]?.observedAtMs).toBe(Date.parse("2026-08-01T12:00:00Z"));
  });

  it("picks the largest ring from a MultiPolygon", () => {
    const geojson = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {},
          geometry: {
            type: "MultiPolygon",
            coordinates: [
              [
                [
                  [-122.0, 37.0],
                  [-121.99, 37.0],
                  [-121.99, 37.01],
                ],
              ],
              [
                [
                  [-122.0, 37.0],
                  [-121.9, 37.0],
                  [-121.9, 37.1],
                  [-122.0, 37.1],
                ],
              ],
            ],
          },
        },
      ],
    };
    const snapshots = HistoricalPerimeterProvider.parse(geojson, "test");
    expect(snapshots[0]?.ring).toHaveLength(4);
  });

  it("refuses to extrapolate into the future", async () => {
    const observedAtMs = NOW_MS - 60_000;
    const geojson = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: { observedAt: new Date(observedAtMs).toISOString() },
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [-122.06, 37.34],
                [-122.04, 37.34],
                [-122.04, 37.36],
                [-122.06, 37.36],
              ],
            ],
          },
        },
      ],
    };
    const path = join(
      process.env["TEMP"] ?? process.cwd(),
      "valoris-test-perimeter.geojson",
    );
    const { writeFileSync } = await import("node:fs");
    writeFileSync(path, JSON.stringify(geojson), "utf8");

    const provider = new HistoricalPerimeterProvider(path);
    expect(provider.isAvailable()).toBe(true);

    const present = await provider.getFireFront(query());
    expect(present.confidence).toBe("high");
    expect(present.isProjection).toBe(false);

    const future = await provider.getFireFront(
      query({ atMs: NOW_MS + 30 * 60_000 }),
    );
    expect(future.confidence).toBe("unknown");
    expect(future.provenance).toContain("does not extrapolate");
    expect(future.provenance).toContain("NOT a prediction");
  });
});

describe("provider registry", () => {
  it("exposes all three providers with honest availability", () => {
    const providers = listFireFrontProviders();
    expect(providers.map((p) => p.key).sort()).toEqual([
      "farsite_adapter",
      "geometric_spread_placeholder",
      "historical_perimeter",
    ]);
    const geometric = providers.find(
      (p) => p.key === "geometric_spread_placeholder",
    );
    expect(geometric?.available).toBe(true);
    expect(geometric?.isFireBehaviourModel).toBe(false);
    expect(providers.find((p) => p.key === "farsite_adapter")?.available).toBe(false);
  });

  it("constructs each provider", () => {
    for (const key of [
      "geometric_spread_placeholder",
      "farsite_adapter",
      "historical_perimeter",
    ] as const) {
      expect(createFireFrontProvider(key).key).toBe(key);
    }
  });
});

describe("architectural boundary", () => {
  const riskFiles = [
    "types.ts",
    "bands.ts",
    "config.ts",
    "engine.ts",
    "index.ts",
    "default-config.ts",
  ];

  it("the risk engine never imports the fire module, a provider, Prisma or Next", () => {
    for (const file of riskFiles) {
      const source = readFileSync(join(process.cwd(), "lib", "risk", file), "utf8");
      expect(source, `${file} must not import lib/fire`).not.toMatch(/from\s+["'].*\/fire/);
      expect(source, `${file} must not import Prisma`).not.toMatch(/@prisma\/client/);
      expect(source, `${file} must not import Next`).not.toMatch(/from\s+["']next/);
      expect(source, `${file} must not mention FARSITE`).not.toMatch(/farsite/i);
    }
  });

  it("the engine takes a distance and a confidence, not a perimeter", () => {
    const source = readFileSync(
      join(process.cwd(), "lib", "risk", "engine.ts"),
      "utf8",
    );
    expect(source).toContain("distanceToFireFrontM");
    expect(source).not.toContain("perimeter");
    expect(source).not.toContain("polygon");
  });
});
