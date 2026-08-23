/**
 * Report invariants.
 *
 * A post-incident report is the document someone reaches for after a bad day,
 * and it will be read by people who were not there. The failure modes are
 * therefore not crashes — they are a report that quietly completes itself, or
 * one that reads like validation when nothing has been validated.
 */

import { describe, expect, it } from "vitest";

import { buildIncidentReport, type ReportInput } from "./incident-report";

const T0 = new Date("2026-01-07T18:30:00Z");
const at = (offsetSec: number): Date => new Date(T0.getTime() + offsetSec * 1000);

function incident(over: Partial<ReportInput["incident"]> = {}) {
  return {
    id: "inc-1",
    organisationId: "org-1",
    name: "test",
    status: "stopped",
    scenarioKey: "test",
    fireProviderKey: "geometric_spread_placeholder",
    centroidLat: 0,
    centroidLng: 0,
    modelVersion: "m1",
    configHash: "abc",
    createdAtUtc: T0,
    startedAtUtc: T0,
    stoppedAtUtc: at(600),
    ...over,
  } as ReportInput["incident"];
}

function deployment(callsign: string, id = `dep-${callsign}`) {
  return {
    id,
    incidentId: "inc-1",
    crewId: "crew-1",
    firefighterProfileId: `ff-${callsign}`,
    sector: null,
    assignedAtUtc: T0,
    releasedAtUtc: null,
    firefighter: {
      id: `ff-${callsign}`,
      callsign,
      ageYears: 40,
      fitness: "moderate",
      conditionsJson: '["asthma"]',
    },
  } as unknown as ReportInput["deployments"][number];
}

function assessment(
  deploymentId: string,
  band: string,
  offsetSec: number,
  over: Record<string, unknown> = {},
) {
  return {
    id: `ras-${deploymentId}-${offsetSec}`,
    incidentId: "inc-1",
    deploymentId,
    calculatedAtUtc: at(offsetSec),
    scoreValue: 30,
    band,
    confidence: "high",
    missingInputsJson: "[]",
    projectedInputsJson: "[]",
    staleInputsJson: "[]",
    configHash: "abc",
    modelVersion: "m1",
    ...over,
  } as unknown as ReportInput["assessments"][number];
}

function base(over: Partial<ReportInput> = {}): ReportInput {
  return {
    incident: incident(),
    deployments: [deployment("ALPHA-1")],
    assessments: [],
    recommendations: [],
    outcomes: [],
    ...over,
  };
}

describe("report — an absence is never a finding", () => {
  it("reports a firefighter with no outcome as NOT RECORDED, never as nothing", () => {
    const report = buildIncidentReport(base());
    const ff = report.firefighters[0]!;

    expect(ff.outcome.recorded).toBe(false);
    // The word that must never appear for an unrecorded outcome.
    expect(JSON.stringify(ff.outcome)).not.toContain("nothing");
  });

  it("says how incomplete it is, and says it in the completeness block", () => {
    const report = buildIncidentReport(
      base({ deployments: [deployment("ALPHA-1"), deployment("BRAVO-1")] }),
    );

    expect(report.completeness.outcomesRecorded).toBe(0);
    expect(report.completeness.outcomesOutstanding).toBe(2);
    expect(report.completeness.complete).toBe(false);
    expect(report.completeness.note).toMatch(/NO recorded outcome/i);
    expect(report.completeness.note).toMatch(/not "nothing happened"/i);
  });

  it("only reports complete when every deployed firefighter has an outcome", () => {
    const report = buildIncidentReport(
      base({
        outcomes: [
          {
            deploymentId: "dep-ALPHA-1",
            outcome: "nothing",
            interventionOccurred: null,
            notes: null,
            recordedBy: "ic",
            recordedAtUtc: at(700),
          } as unknown as ReportInput["outcomes"][number],
        ],
      }),
    );
    expect(report.completeness.complete).toBe(true);
    expect(report.firefighters[0]!.outcome.recorded).toBe(true);
  });
});

describe("report — never implies validation", () => {
  it("always carries limitations, however clean the incident", () => {
    const report = buildIncidentReport(base());
    expect(report.limitations.length).toBeGreaterThan(0);
    const joined = report.limitations.join(" ");
    expect(joined).toMatch(/nothing in this report is validated/i);
    expect(joined).toMatch(/what the model said, not what was true/i);
  });

  it("warns that outcomes are interventional", () => {
    const joined = buildIncidentReport(base()).limitations.join(" ");
    // A firefighter withdrawn on CRITICAL who is then fine is not proof the
    // band was wrong — it may be proof the withdrawal worked.
    expect(joined).toMatch(/interventional/i);
  });

  it("flags a configuration change mid-incident as a comparability problem", () => {
    const report = buildIncidentReport(
      base({
        assessments: [
          assessment("dep-ALPHA-1", "SAFE", 0, { configHash: "abc" }),
          assessment("dep-ALPHA-1", "HIGH", 60, { configHash: "def" }),
        ],
      }),
    );
    expect(report.reproducibility.configChangedDuringIncident).toBe(true);
    expect(report.reproducibility.configHashesSeen).toEqual(["abc", "def"]);
    expect(report.limitations.join(" ")).toMatch(/CONFIGURATION CHANGED/);
  });
});

describe("report — the evidential chain", () => {
  it("records band transitions with the time they happened", () => {
    const report = buildIncidentReport(
      base({
        assessments: [
          assessment("dep-ALPHA-1", "SAFE", 0),
          assessment("dep-ALPHA-1", "SAFE", 60),
          assessment("dep-ALPHA-1", "HIGH", 120),
          assessment("dep-ALPHA-1", "CRITICAL", 180),
        ],
      }),
    );
    const ff = report.firefighters[0]!;
    expect(ff.bandTransitions).toEqual([
      { atUtc: at(120).toISOString(), from: "SAFE", to: "HIGH" },
      { atUtc: at(180).toISOString(), from: "HIGH", to: "CRITICAL" },
    ]);
    expect(ff.peakBand).toBe("CRITICAL");
  });

  it("attributes time to the band that was showing, not the one that followed", () => {
    const report = buildIncidentReport(
      base({
        assessments: [
          assessment("dep-ALPHA-1", "SAFE", 0),
          assessment("dep-ALPHA-1", "HIGH", 100),
          assessment("dep-ALPHA-1", "HIGH", 160),
        ],
      }),
    );
    const spells = Object.fromEntries(
      report.firefighters[0]!.timeInBand.map((s) => [s.band, s.seconds]),
    );
    expect(spells.SAFE).toBe(100);
    // The final assessment contributes nothing — nothing was observed after it.
    expect(spells.HIGH).toBe(60);
  });

  it("counts how much of the picture was imputed rather than measured", () => {
    const report = buildIncidentReport(
      base({
        assessments: [
          assessment("dep-ALPHA-1", "SAFE", 0),
          assessment("dep-ALPHA-1", "UNKNOWN", 60, {
            projectedInputsJson: '["hrBpm"]',
            confidence: "low",
          }),
          assessment("dep-ALPHA-1", "UNKNOWN", 120, {
            missingInputsJson: '["hrBpm","coPpm"]',
            confidence: "low",
          }),
        ],
      }),
    );
    const dq = report.firefighters[0]!.dataQuality;
    expect(dq.assessmentsWithProjectedInputs).toBe(1);
    expect(dq.assessmentsWithMissingInputs).toBe(1);
    expect(dq.lowConfidenceAssessments).toBe(2);
    expect(dq.channelsEverProjected).toEqual({ hrBpm: 1 });
    expect(dq.channelsEverMissing).toEqual({ hrBpm: 1, coPpm: 1 });
  });

  it("keeps the reason a commander declined advice", () => {
    const report = buildIncidentReport(
      base({
        recommendations: [
          {
            id: "rec-1",
            incidentId: "inc-1",
            deploymentId: "dep-ALPHA-1",
            type: "rotate",
            status: "rejected",
            confidence: "medium",
            suggestedAction: "Rotate out at the next safe opportunity.",
            createdAtUtc: at(60),
            commanderActions: [
              {
                action: "reject",
                actorLabel: "IC Bell",
                reasonText: "Relief not yet in position; holding two more minutes.",
                createdAtUtc: at(90),
              },
            ],
          } as unknown as ReportInput["recommendations"][number],
        ],
      }),
    );
    const rec = report.firefighters[0]!.recommendations[0]!;
    expect(rec.status).toBe("rejected");
    // The reason is the whole point of asking. It must survive into the report.
    expect(rec.actions[0]!.reasonText).toMatch(/Relief not yet in position/);
    expect(rec.actions[0]!.actorLabel).toBe("IC Bell");
    expect(report.totals.recommendationsRejected).toBe(1);
  });

  it("separates advice that expired unactioned from advice that was declined", () => {
    const mk = (id: string, status: string, actions: unknown[]) =>
      ({
        id,
        incidentId: "inc-1",
        deploymentId: "dep-ALPHA-1",
        type: "monitor",
        status,
        confidence: "high",
        suggestedAction: "Keep them in view.",
        createdAtUtc: at(10),
        commanderActions: actions,
      }) as unknown as ReportInput["recommendations"][number];

    const report = buildIncidentReport(
      base({
        recommendations: [
          mk("a", "expired", []),
          mk("b", "accepted", [
            { action: "accept", actorLabel: "ic", reasonText: null, createdAtUtc: at(20) },
          ]),
        ],
      }),
    );
    // Nobody looked at the first one. That is a different fact from declining it.
    expect(report.totals.recommendationsExpiredUnactioned).toBe(1);
    expect(report.totals.recommendationsAccepted).toBe(1);
  });
});
