import { readFileSync } from "node:fs";
import { join } from "node:path";

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  assertObservationProvenanceCoherent,
  assertProvenanceCoherent,
  DATA_TIERS,
  isFullySimulated,
  PROVENANCE,
  PROVENANCE_DOMAINS,
  provenanceStrip,
  TIER_BADGE,
  TIER_DISCLOSURE,
  TIER_LABEL,
  tierSummary,
  tiersPresent,
  type DataTier,
  type ObservationProvenance,
  type Provenance,
} from "./types";

const ALL_SYNTHETIC: ObservationProvenance = {
  environment: PROVENANCE.simulatedEnvironment,
  vitals: PROVENANCE.simulatedVitals,
  position: PROVENANCE.simulatedPosition,
  derivedPhysiology: PROVENANCE.derivedPhysiology,
  fireFront: PROVENANCE.geometricFireFront,
};

const MIXED_WITH_REAL_PERIMETER: ObservationProvenance = {
  ...ALL_SYNTHETIC,
  fireFront: PROVENANCE.observedPerimeter,
};

describe("data tiers", () => {
  it("has exactly the three tiers the addendum specifies", () => {
    expect(DATA_TIERS).toEqual([
      "A_REAL_ENVIRONMENTAL",
      "B_REAL_WEARABLE_NON_FIREFIGHTER",
      "C_SYNTHETIC_MODEL_DRIVEN",
    ]);
  });

  it("labels, badges and disclosures cover every tier", () => {
    for (const tier of DATA_TIERS) {
      expect(TIER_LABEL[tier].length).toBeGreaterThan(0);
      expect(TIER_BADGE[tier].length).toBeGreaterThan(0);
      expect(TIER_DISCLOSURE[tier].length).toBeGreaterThan(0);
    }
  });

  it("badges carry the tier letter, never colour alone", () => {
    expect(TIER_BADGE.A_REAL_ENVIRONMENTAL).toMatch(/^A/);
    expect(TIER_BADGE.B_REAL_WEARABLE_NON_FIREFIGHTER).toMatch(/^B/);
    expect(TIER_BADGE.C_SYNTHETIC_MODEL_DRIVEN).toMatch(/^C/);
  });

  it("uses the addendum's mandatory Tier B wording verbatim", () => {
    expect(TIER_DISCLOSURE.B_REAL_WEARABLE_NON_FIREFIGHTER).toBe(
      "Signal characteristics derived from WESAD/PAMAP2 (non-firefighter human subjects). Not firefighter physiological data.",
    );
  });

  it("Tier B badge never omits that the subjects are not firefighters", () => {
    expect(TIER_BADGE.B_REAL_WEARABLE_NON_FIREFIGHTER).toContain("not firefighter");
  });
});

describe("tier aggregation never blurs", () => {
  it("reports every tier present, not a single collapsed one", () => {
    expect(tiersPresent(ALL_SYNTHETIC)).toEqual(["C_SYNTHETIC_MODEL_DRIVEN"]);
    expect(tiersPresent(MIXED_WITH_REAL_PERIMETER)).toEqual([
      "A_REAL_ENVIRONMENTAL",
      "C_SYNTHETIC_MODEL_DRIVEN",
    ]);
  });

  it("summarises a mixed observation as A+C, not as A and not as C", () => {
    expect(tierSummary(ALL_SYNTHETIC)).toBe("C");
    expect(tierSummary(MIXED_WITH_REAL_PERIMETER)).toBe("A+C");
  });

  it("only calls an observation fully simulated when every domain is", () => {
    expect(isFullySimulated(ALL_SYNTHETIC)).toBe(true);
    expect(isFullySimulated(MIXED_WITH_REAL_PERIMETER)).toBe(false);
  });

  it("orders tiers A, B, C regardless of domain order", () => {
    const provenance: ObservationProvenance = {
      environment: { dataTier: "C_SYNTHETIC_MODEL_DRIVEN", source: "x", isSimulated: true },
      vitals: { dataTier: "B_REAL_WEARABLE_NON_FIREFIGHTER", source: "y", isSimulated: false },
      position: { dataTier: "C_SYNTHETIC_MODEL_DRIVEN", source: "z", isSimulated: true },
      derivedPhysiology: { dataTier: "C_SYNTHETIC_MODEL_DRIVEN", source: "w", isSimulated: true },
      fireFront: { dataTier: "A_REAL_ENVIRONMENTAL", source: "v", isSimulated: false },
    };
    expect(tierSummary(provenance)).toBe("A+B+C");
  });
});

describe("provenance strip", () => {
  it("covers every domain and states REAL or SIMULATED explicitly", () => {
    const strip = provenanceStrip(MIXED_WITH_REAL_PERIMETER);
    expect(strip).toHaveLength(PROVENANCE_DOMAINS.length);
    for (const line of strip) {
      expect(["REAL", "SIMULATED"]).toContain(line.verdict);
      expect(line.source.length).toBeGreaterThan(0);
      expect(line.disclosure.length).toBeGreaterThan(0);
    }
  });

  it("marks crew positions as simulated, always", () => {
    const positions = provenanceStrip(MIXED_WITH_REAL_PERIMETER).find(
      (l) => l.domain === "Crew positions",
    );
    expect(positions?.verdict).toBe("SIMULATED");
  });

  it("marks physiology as simulated, always", () => {
    const physiology = provenanceStrip(MIXED_WITH_REAL_PERIMETER).find(
      (l) => l.domain === "Physiology",
    );
    expect(physiology?.verdict).toBe("SIMULATED");
    expect(physiology?.tier).toBe("C_SYNTHETIC_MODEL_DRIVEN");
  });

  it("marks a real observed perimeter as REAL", () => {
    const front = provenanceStrip(MIXED_WITH_REAL_PERIMETER).find(
      (l) => l.domain === "Fire front",
    );
    expect(front?.verdict).toBe("REAL");
    expect(front?.tier).toBe("A_REAL_ENVIRONMENTAL");
  });

  it("marks the placeholder fire front as SIMULATED", () => {
    const front = provenanceStrip(ALL_SYNTHETIC).find((l) => l.domain === "Fire front");
    expect(front?.verdict).toBe("SIMULATED");
    expect(front?.tier).toBe("C_SYNTHETIC_MODEL_DRIVEN");
  });
});

describe("mislabelling is rejected at construction", () => {
  it("refuses Tier A marked simulated", () => {
    expect(() =>
      assertProvenanceCoherent(
        { dataTier: "A_REAL_ENVIRONMENTAL", source: "nifc", isSimulated: true },
        "test",
      ),
    ).toThrow(/cannot be marked isSimulated/);
  });

  it("refuses Tier C marked real — the most damaging mislabel", () => {
    expect(() =>
      assertProvenanceCoherent(
        { dataTier: "C_SYNTHETIC_MODEL_DRIVEN", source: "model", isSimulated: false },
        "test",
      ),
    ).toThrow(/must be marked isSimulated/);
  });

  it("refuses Tier B marked simulated", () => {
    expect(() =>
      assertProvenanceCoherent(
        { dataTier: "B_REAL_WEARABLE_NON_FIREFIGHTER", source: "wesad", isSimulated: true },
        "test",
      ),
    ).toThrow(/cannot be marked isSimulated/);
  });

  it("refuses an unnamed source", () => {
    expect(() =>
      assertProvenanceCoherent(
        { dataTier: "C_SYNTHETIC_MODEL_DRIVEN", source: "   ", isSimulated: true },
        "test",
      ),
    ).toThrow(/must name a source/);
  });

  it("accepts every declared provenance record", () => {
    for (const [key, record] of Object.entries(PROVENANCE)) {
      expect(() => assertProvenanceCoherent(record, key)).not.toThrow();
    }
  });

  it("checks every domain of an observation", () => {
    expect(() =>
      assertObservationProvenanceCoherent(ALL_SYNTHETIC, "obs"),
    ).not.toThrow();
    expect(() =>
      assertObservationProvenanceCoherent(
        {
          ...ALL_SYNTHETIC,
          vitals: { dataTier: "C_SYNTHETIC_MODEL_DRIVEN", source: "s", isSimulated: false },
        },
        "obs",
      ),
    ).toThrow(/obs\.vitals/);
  });
});

describe("declared provenance records", () => {
  it("never claims Tier B, because no noise model has been built", () => {
    for (const record of Object.values(PROVENANCE)) {
      expect(record.dataTier).not.toBe("B_REAL_WEARABLE_NON_FIREFIGHTER");
    }
  });

  it("marks the geometric fire front as synthetic and says it is not a prediction", () => {
    expect(PROVENANCE.geometricFireFront.dataTier).toBe("C_SYNTHETIC_MODEL_DRIVEN");
    expect(PROVENANCE.geometricFireFront.isSimulated).toBe(true);
    expect(PROVENANCE.geometricFireFront.modelRef).toContain(
      "Not a fire behaviour prediction",
    );
  });

  it("marks simulated crew positions and never implies they are real", () => {
    expect(PROVENANCE.simulatedPosition.isSimulated).toBe(true);
    expect(PROVENANCE.simulatedPosition.modelRef).toContain("never invented");
  });

  it("records a licence for the one real source", () => {
    expect(PROVENANCE.observedPerimeter.dataTier).toBe("A_REAL_ENVIRONMENTAL");
    expect(PROVENANCE.observedPerimeter.isSimulated).toBe(false);
    expect(PROVENANCE.observedPerimeter.licence).toBeDefined();
  });

  it("cites the models behind derived physiology", () => {
    expect(PROVENANCE.derivedPhysiology.modelRef).toContain("ISO 7933");
    expect(PROVENANCE.derivedPhysiology.modelRef).toContain("Karvonen");
  });
});

describe("provenance properties", () => {
  const arbTier: fc.Arbitrary<DataTier> = fc.constantFrom(...DATA_TIERS);

  const arbProvenance: fc.Arbitrary<Provenance> = arbTier.map((dataTier) => ({
    dataTier,
    source: `src_${dataTier}`,
    isSimulated: dataTier === "C_SYNTHETIC_MODEL_DRIVEN",
  }));

  it("coherent records always pass their own assertion", () => {
    fc.assert(
      fc.property(arbProvenance, (p) => {
        expect(() => assertProvenanceCoherent(p, "prop")).not.toThrow();
      }),
    );
  });

  it("a summary never loses a tier that is present", () => {
    fc.assert(
      fc.property(
        arbProvenance,
        arbProvenance,
        arbProvenance,
        arbProvenance,
        arbProvenance,
        (a, b, c, d, e) => {
          const provenance: ObservationProvenance = {
            environment: a,
            vitals: b,
            position: c,
            derivedPhysiology: d,
            fireFront: e,
          };
          const summary = tierSummary(provenance);
          for (const domain of PROVENANCE_DOMAINS) {
            expect(summary).toContain(provenance[domain].dataTier.charAt(0));
          }
        },
      ),
    );
  });

  it("a strip line is simulated exactly when its record is", () => {
    fc.assert(
      fc.property(
        arbProvenance,
        arbProvenance,
        arbProvenance,
        arbProvenance,
        arbProvenance,
        (a, b, c, d, e) => {
          const provenance: ObservationProvenance = {
            environment: a,
            vitals: b,
            position: c,
            derivedPhysiology: d,
            fireFront: e,
          };
          for (const line of provenanceStrip(provenance)) {
            const expected = Object.values(provenance).some(
              (p) => p.source === line.source && p.isSimulated,
            );
            if (line.verdict === "SIMULATED") expect(expected).toBe(true);
          }
        },
      ),
    );
  });
});

describe("provenance module boundary", () => {
  it("is pure — no framework, database or model imports", () => {
    const source = readFileSync(
      join(process.cwd(), "lib", "provenance", "types.ts"),
      "utf8",
    );
    expect(source).not.toMatch(/@prisma\/client/);
    expect(source).not.toMatch(/from\s+["']next/);
    expect(source).not.toMatch(/from\s+["']\.\.\//);
    expect(source).not.toMatch(/Date\.now\(\)/);
  });

  it("the risk engine does not import provenance — tiers are a reporting concern", () => {
    // The word itself is fine in prose (risk/config.ts discusses parameter
    // provenance). The rule is that no *import* crosses into the risk engine.
    for (const file of ["engine.ts", "types.ts", "config.ts", "bands.ts"]) {
      const source = readFileSync(join(process.cwd(), "lib", "risk", file), "utf8");
      expect(source, `lib/risk/${file}`).not.toMatch(
        /(import|from)\s+["'][^"']*provenance/i,
      );
    }
  });
});
