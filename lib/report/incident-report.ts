/**
 * Post-incident report.
 *
 * The point of this is not a summary. It is the evidential chain:
 *
 *     what the model SAID  →  what the commander DID  →  what actually HAPPENED
 *
 * Any one of those alone is close to useless. The band history without the
 * commander's actions cannot tell you whether advice was followed. The actions
 * without outcomes cannot tell you whether following it helped. And outcomes
 * without the first two cannot tell you what anyone knew at the time.
 *
 * TWO RULES.
 *
 * 1. Never present an absence as a finding. A firefighter with no recorded
 *    outcome is reported as `not recorded`, never as `nothing happened`. The
 *    report says how much of itself is missing, at the top, before anything
 *    else.
 *
 * 2. Never imply validation. This report shows what the model produced against
 *    thresholds nobody has reviewed. It is evidence for a conversation with a
 *    clinician, not evidence that the model works.
 *
 * SIMULATION MODE — NOT FOR OPERATIONAL USE.
 */

import type {
  CommanderAction,
  Deployment,
  FirefighterProfile,
  Incident,
  IncidentOutcome,
  Recommendation,
  RiskAssessmentRecord,
} from "@prisma/client";

export type ReportInput = {
  incident: Incident;
  deployments: (Deployment & { firefighter: FirefighterProfile })[];
  assessments: RiskAssessmentRecord[];
  recommendations: (Recommendation & { commanderActions: CommanderAction[] })[];
  outcomes: IncidentOutcome[];
};

export type BandSpell = {
  band: string;
  seconds: number;
};

export type FirefighterReport = {
  callsign: string;
  ageYears: number;
  fitness: string;
  conditions: string[];

  assessments: number;
  peakBand: string;
  peakScore: number;
  timeInBand: BandSpell[];
  bandTransitions: { atUtc: string; from: string; to: string }[];

  /** How much of this firefighter's picture was actually measured. */
  dataQuality: {
    assessmentsWithMissingInputs: number;
    assessmentsWithProjectedInputs: number;
    lowConfidenceAssessments: number;
    /** Channels that went dark at any point, with how often. */
    channelsEverMissing: Record<string, number>;
    channelsEverProjected: Record<string, number>;
  };

  recommendations: {
    type: string;
    createdAtUtc: string;
    confidence: string;
    status: string;
    suggestedAction: string;
    /** What the commander did, and why if they declined. */
    actions: { action: string; actorLabel: string; reasonText: string | null; atUtc: string }[];
  }[];

  outcome:
    | {
        recorded: true;
        outcome: string;
        interventionOccurred: boolean | null;
        notes: string | null;
        recordedBy: string;
        recordedAtUtc: string;
      }
    | { recorded: false };
};

export type IncidentReport = {
  incident: {
    id: string;
    name: string;
    status: string;
    scenarioKey: string;
    fireProviderKey: string;
    createdAtUtc: string;
    startedAtUtc: string | null;
    stoppedAtUtc: string | null;
    durationSec: number | null;
  };

  /**
   * Everything needed to reconstruct what the engine was doing. A report whose
   * numbers cannot be tied to a model version and a config hash is an anecdote.
   */
  reproducibility: {
    modelVersion: string;
    configHash: string;
    /** Distinct config hashes seen across the incident. More than one means the configuration changed mid-incident. */
    configHashesSeen: string[];
    configChangedDuringIncident: boolean;
  };

  completeness: {
    deployments: number;
    outcomesRecorded: number;
    outcomesOutstanding: number;
    /** True when every deployed firefighter has an outcome. */
    complete: boolean;
    note: string;
  };

  firefighters: FirefighterReport[];

  totals: {
    assessments: number;
    recommendations: number;
    recommendationsAccepted: number;
    recommendationsRejected: number;
    recommendationsExpiredUnactioned: number;
  };

  limitations: string[];
};

const BAND_ORDER = ["SAFE", "CAUTION", "HIGH", "CRITICAL", "UNKNOWN"] as const;

function worstBand(a: string, b: string): string {
  // UNKNOWN is not "worst" in a clinical sense, but it is never dismissible, so
  // it outranks everything except CRITICAL for the purposes of a peak.
  const rank = (x: string): number => {
    const i = BAND_ORDER.indexOf(x as (typeof BAND_ORDER)[number]);
    return i < 0 ? -1 : i;
  };
  return rank(a) >= rank(b) ? a : b;
}

function countBy(values: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const v of values) out[v] = (out[v] ?? 0) + 1;
  return out;
}

function parseJsonArray(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export function buildIncidentReport(input: ReportInput): IncidentReport {
  const { incident, deployments, assessments, recommendations, outcomes } = input;

  const byDeployment = new Map<string, RiskAssessmentRecord[]>();
  for (const a of assessments) {
    const list = byDeployment.get(a.deploymentId) ?? [];
    list.push(a);
    byDeployment.set(a.deploymentId, list);
  }

  const outcomeByDeployment = new Map(outcomes.map((o) => [o.deploymentId, o]));

  const firefighters: FirefighterReport[] = deployments.map((deployment) => {
    const rows = (byDeployment.get(deployment.id) ?? []).sort(
      (a, b) => a.calculatedAtUtc.getTime() - b.calculatedAtUtc.getTime(),
    );

    let peakBand = "SAFE";
    let peakScore = 0;
    const timeInBand = new Map<string, number>();
    const transitions: { atUtc: string; from: string; to: string }[] = [];

    const missingCounts: string[] = [];
    const projectedCounts: string[] = [];
    let withMissing = 0;
    let withProjected = 0;
    let lowConfidence = 0;

    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i] as RiskAssessmentRecord;
      peakBand = worstBand(peakBand, row.band);
      if (row.scoreValue > peakScore) peakScore = row.scoreValue;

      // Time in band is the gap to the NEXT assessment. The final assessment
      // contributes nothing, because nothing was observed after it.
      const next = rows[i + 1];
      if (next !== undefined) {
        const seconds =
          (next.calculatedAtUtc.getTime() - row.calculatedAtUtc.getTime()) / 1000;
        timeInBand.set(row.band, (timeInBand.get(row.band) ?? 0) + seconds);
        if (next.band !== row.band) {
          transitions.push({
            atUtc: next.calculatedAtUtc.toISOString(),
            from: row.band,
            to: next.band,
          });
        }
      }

      const missing = parseJsonArray(row.missingInputsJson);
      const projected = parseJsonArray(row.projectedInputsJson);
      if (missing.length > 0) withMissing += 1;
      if (projected.length > 0) withProjected += 1;
      if (row.confidence === "low") lowConfidence += 1;
      missingCounts.push(...missing);
      projectedCounts.push(...projected);
    }

    const recs = recommendations
      .filter((r) => r.deploymentId === deployment.id)
      .sort((a, b) => a.createdAtUtc.getTime() - b.createdAtUtc.getTime())
      .map((r) => ({
        type: r.type,
        createdAtUtc: r.createdAtUtc.toISOString(),
        confidence: r.confidence,
        status: r.status,
        suggestedAction: r.suggestedAction,
        actions: r.commanderActions
          .sort((a, b) => a.createdAtUtc.getTime() - b.createdAtUtc.getTime())
          .map((a) => ({
            action: a.action,
            actorLabel: a.actorLabel,
            reasonText: a.reasonText,
            atUtc: a.createdAtUtc.toISOString(),
          })),
      }));

    const outcome = outcomeByDeployment.get(deployment.id);

    return {
      callsign: deployment.firefighter.callsign,
      ageYears: deployment.firefighter.ageYears,
      fitness: deployment.firefighter.fitness,
      conditions: parseJsonArray(deployment.firefighter.conditionsJson),

      assessments: rows.length,
      peakBand,
      peakScore: Math.round(peakScore * 10) / 10,
      timeInBand: [...timeInBand.entries()]
        .map(([band, seconds]) => ({ band, seconds: Math.round(seconds) }))
        .sort((a, b) => b.seconds - a.seconds),
      bandTransitions: transitions,

      dataQuality: {
        assessmentsWithMissingInputs: withMissing,
        assessmentsWithProjectedInputs: withProjected,
        lowConfidenceAssessments: lowConfidence,
        channelsEverMissing: countBy(missingCounts),
        channelsEverProjected: countBy(projectedCounts),
      },

      recommendations: recs,

      outcome:
        outcome === undefined
          ? { recorded: false }
          : {
              recorded: true,
              outcome: outcome.outcome,
              interventionOccurred: outcome.interventionOccurred,
              notes: outcome.notes,
              recordedBy: outcome.recordedBy,
              recordedAtUtc: outcome.recordedAtUtc.toISOString(),
            },
    };
  });

  const configHashesSeen = [...new Set(assessments.map((a) => a.configHash))];
  const outcomesRecorded = outcomes.length;
  const outstanding = deployments.length - outcomesRecorded;

  const accepted = recommendations.filter((r) => r.status === "accepted").length;
  const rejected = recommendations.filter(
    (r) => r.status === "rejected" || r.status === "overridden",
  ).length;
  const expiredUnactioned = recommendations.filter(
    (r) => r.status === "expired" && r.commanderActions.length === 0,
  ).length;

  const durationSec =
    incident.startedAtUtc !== null && incident.stoppedAtUtc !== null
      ? Math.round(
          (incident.stoppedAtUtc.getTime() - incident.startedAtUtc.getTime()) / 1000,
        )
      : null;

  return {
    incident: {
      id: incident.id,
      name: incident.name,
      status: incident.status,
      scenarioKey: incident.scenarioKey,
      fireProviderKey: incident.fireProviderKey,
      createdAtUtc: incident.createdAtUtc.toISOString(),
      startedAtUtc: incident.startedAtUtc?.toISOString() ?? null,
      stoppedAtUtc: incident.stoppedAtUtc?.toISOString() ?? null,
      durationSec,
    },

    reproducibility: {
      modelVersion: incident.modelVersion,
      configHash: incident.configHash,
      configHashesSeen,
      configChangedDuringIncident: configHashesSeen.length > 1,
    },

    completeness: {
      deployments: deployments.length,
      outcomesRecorded,
      outcomesOutstanding: outstanding,
      complete: outstanding === 0 && deployments.length > 0,
      note:
        outstanding === 0
          ? "Every deployed firefighter has a recorded outcome."
          : `${outstanding} of ${deployments.length} firefighters have NO recorded outcome. An unrecorded outcome is not "nothing happened" — it is unknown, and this report cannot be used for calibration until it is filled in.`,
    },

    firefighters,

    totals: {
      assessments: assessments.length,
      recommendations: recommendations.length,
      recommendationsAccepted: accepted,
      recommendationsRejected: rejected,
      recommendationsExpiredUnactioned: expiredUnactioned,
    },

    limitations: [
      "Nothing in this report is validated. Every threshold behind these bands ships as illustrative and unreviewed; no clinician has approved any of them.",
      "A band is what the model said, not what was true. This report cannot tell you whether the model was right — only what it produced and what happened next.",
      "Outcomes are interventional. A firefighter withdrawn on a CRITICAL band who then suffered nothing is not evidence the band was wrong; it may be evidence the withdrawal worked. Check interventionOccurred before drawing any conclusion.",
      "Time in band is measured between assessments, so it inherits the observation cadence. A gap in the feed looks like time spent in the band before it.",
      "Projected channels are estimates, not measurements. Assessments carrying projectedInputs were scored partly on imputed values.",
      ...(configHashesSeen.length > 1
        ? [
            "THE CONFIGURATION CHANGED DURING THIS INCIDENT. Assessments before and after are not directly comparable, and the per-assessment config snapshot must be consulted before treating this incident as one series.",
          ]
        : []),
    ],
  };
}
