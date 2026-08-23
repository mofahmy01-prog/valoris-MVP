/**
 * Recommendation invariants.
 *
 * These assert the three rules the module claims to obey. Each one is a way a
 * safety advisory system fails quietly in the field: by over-claiming certainty
 * it does not have, by panicking on absent data, or by talking so much that
 * commanders stop reading it.
 */

import { describe, expect, it } from "vitest";

import { recommendFor, recommendationKey, RECOMMENDATION_TTL_MS } from "./engine";
import type { RiskAssessment } from "@/lib/risk/types";

function assessment(over: Partial<RiskAssessment> = {}): RiskAssessment {
  return {
    firefighterId: "ff-1",
    calculatedAtMs: 1_700_000_000_000,
    score: 10,
    band: "SAFE",
    subscores: {
      physiological: 10,
      environmental: 10,
      proximity: 10,
      profile: 10,
    },
    hardOverride: false,
    hardOverrideReasons: [],
    topDrivers: [],
    explanation: "",
    dataQuality: {
      confidence: "high",
      staleInputs: [],
      missingInputs: [],
      note: "",
      oldestReadingAgeSec: 0,
    },
    modelVersion: "test",
    configHash: "test",
    ...over,
  } as RiskAssessment;
}

const CTX = { callsign: "ALPHA-1" };

describe("recommendations — Valoris advises, it does not instruct", () => {
  it("says nothing about a SAFE firefighter with clean data", () => {
    // Manufacturing advice for someone who is fine is how a feed gets ignored.
    expect(recommendFor(assessment(), CTX)).toEqual([]);
  });

  it("always offers at least one alternative, never a bare instruction", () => {
    const all = [
      recommendFor(assessment({ band: "CRITICAL", score: 90 }), CTX),
      recommendFor(assessment({ band: "HIGH", score: 60 }), CTX),
      recommendFor(assessment({ band: "CAUTION", score: 40 }), CTX),
      recommendFor(assessment({ band: "UNKNOWN" }), CTX),
      recommendFor(assessment(), { ...CTX, scbaPressurePct: 12 }),
    ].flat();

    expect(all.length).toBeGreaterThan(0);
    for (const r of all) {
      expect(r.alternatives.length, `${r.type} offered no alternative`).toBeGreaterThan(0);
      expect(r.suggestedAction.length).toBeGreaterThan(0);
      expect(r.rationale.length).toBeGreaterThan(0);
    }
  });
});

describe("recommendations — never claim more certainty than the evidence", () => {
  it("carries the assessment's confidence, never upgrades it", () => {
    for (const confidence of ["high", "medium", "low"] as const) {
      const recs = recommendFor(
        assessment({
          band: "CRITICAL",
          score: 90,
          dataQuality: { confidence, staleInputs: [], missingInputs: [], note: "", oldestReadingAgeSec: 0 },
        }),
        CTX,
      );
      for (const r of recs) expect(r.confidence).toBe(confidence);
    }
  });

  it("says so, in the rationale, when data quality is low", () => {
    const recs = recommendFor(
      assessment({
        band: "CRITICAL",
        score: 90,
        dataQuality: { confidence: "low", staleInputs: [], missingInputs: [], note: "", oldestReadingAgeSec: 0 },
      }),
      CTX,
    );
    expect(recs.length).toBeGreaterThan(0);
    for (const r of recs) expect(r.rationale).toMatch(/LOW/);
  });
});

describe("recommendations — not knowing is actionable, and is not a withdrawal", () => {
  it("asks to find out rather than to withdraw on UNKNOWN", () => {
    const recs = recommendFor(assessment({ band: "UNKNOWN" }), CTX);
    const types = recs.map((r) => r.type);

    expect(types).toContain("insufficient_data");
    // The whole point: absent evidence must not trigger a withdrawal.
    expect(types).not.toContain("withdraw");
  });

  it("names the dead channel rather than reporting a vague fault", () => {
    const recs = recommendFor(
      assessment({
        band: "UNKNOWN",
        dataQuality: {
          confidence: "low",
          staleInputs: [],
          missingInputs: ["hrBpm", "coPpm"],
          note: "",
          oldestReadingAgeSec: 0,
        },
      }),
      CTX,
    );
    const sensor = recs.find((r) => r.type === "check_sensor");
    expect(sensor).toBeDefined();
    expect(sensor!.rationale).toContain("hrBpm");
    expect(sensor!.rationale).toContain("coPpm");
  });
});

describe("recommendations — ordering and triggers", () => {
  it("puts a withdrawal above everything else", () => {
    const recs = recommendFor(
      assessment({
        band: "CRITICAL",
        score: 95,
        hardOverride: true,
        hardOverrideReasons: ["core temperature at 39.8 C"],
        topDrivers: ["core temp"],
      }),
      { ...CTX, scbaPressurePct: 10 },
    );
    expect(recs[0]?.type).toBe("withdraw");
    // and the reason travels with it, rather than "see dashboard"
    expect(recs[0]?.rationale).toContain("core temperature at 39.8 C");
  });

  it("pre-positions relief for someone who is fine now but will not be", () => {
    const recs = recommendFor(
      assessment({ band: "SAFE" }),
      { ...CTX, minutesToDanger: 35 },
    );
    expect(recs.map((r) => r.type)).toContain("preposition_relief");
    expect(recs[0]?.rationale).toContain("35 minutes");
  });

  it("does not pre-position for someone already in trouble — the advice is rotate", () => {
    const recs = recommendFor(
      assessment({ band: "HIGH", score: 60 }),
      { ...CTX, minutesToDanger: 20 },
    );
    const types = recs.map((r) => r.type);
    expect(types).toContain("rotate");
    expect(types).not.toContain("preposition_relief");
  });

  it("escalates a position inside the perimeter regardless of band", () => {
    const recs = recommendFor(assessment({ band: "SAFE" }), {
      ...CTX,
      insidePerimeter: true,
    });
    expect(recs.map((r) => r.type)).toContain("withdraw");
    // and warns that a stale fix is indistinguishable from this
    expect(recs.find((r) => r.type === "withdraw")!.alternatives.join(" ")).toMatch(
      /stale fix/i,
    );
  });

  it("is deterministic — same input, identical output", () => {
    const a = recommendFor(assessment({ band: "HIGH", score: 60 }), CTX);
    const b = recommendFor(assessment({ band: "HIGH", score: 60 }), CTX);
    expect(a).toEqual(b);
  });
});

describe("recommendations — deduplication and expiry", () => {
  it("gives the same advice the same key so it is not re-raised", () => {
    expect(recommendationKey("dep-1", "rotate")).toBe(recommendationKey("dep-1", "rotate"));
    expect(recommendationKey("dep-1", "rotate")).not.toBe(
      recommendationKey("dep-2", "rotate"),
    );
  });

  it("expires fast enough that stale advice becomes a prompt, not a backlog", () => {
    expect(RECOMMENDATION_TTL_MS).toBeLessThanOrEqual(15 * 60_000);
    expect(RECOMMENDATION_TTL_MS).toBeGreaterThan(60_000);
  });
});
