/**
 * Recommendation generation — turning a risk assessment into advice.
 *
 * Deliberately framework-free and deterministic, like `lib/risk/`. The same
 * assessment plus the same context produces the same advice, so a
 * recommendation can be reconstructed and argued with after the fact.
 *
 * THREE RULES THIS MODULE OBEYS.
 *
 * 1. Valoris recommends; the commander decides. Nothing here withdraws anyone,
 *    and no recommendation is phrased as an instruction. Every one carries
 *    alternatives, because a commander who can only comply or ignore has not
 *    been given a decision.
 *
 * 2. A recommendation may never claim more certainty than the assessment it
 *    came from. Advice generated from low-confidence data says so, in the
 *    rationale, where the reader cannot miss it.
 *
 * 3. Not knowing is itself actionable. An `UNKNOWN` band produces neither
 *    silence nor a withdrawal — it produces "find out", which is the honest
 *    response to a dead sensor and is why `check_sensor` and
 *    `insufficient_data` exist as first-class types.
 *
 * SIMULATION MODE — NOT FOR OPERATIONAL USE. No advice here has been reviewed
 * by anyone qualified to give it.
 */

import type { RecommendationType } from "@/lib/db/enums";
import { BAND_SEVERITY } from "@/lib/risk/bands";
import type { RiskAssessment, RiskBand } from "@/lib/risk/types";

/**
 * How long a recommendation stays open before it must be re-made.
 *
 * A fireground picture goes stale fast, and advice that outlives the situation
 * that produced it is worse than no advice: it carries the authority of the
 * system without its evidence. Ten minutes is short enough that an expired
 * recommendation is a prompt to look again rather than a backlog.
 */
export const RECOMMENDATION_TTL_MS = 10 * 60_000;

/** SCBA at or below this is treated as a hard clock. Percent remaining. */
const SCBA_PREPOSITION_PCT = 25;

/** How far ahead a projected threshold crossing is worth pre-positioning for. */
const PREPOSITION_HORIZON_MIN = 60;

/**
 * Priority ranks. Lower sorts first.
 *
 * Equipment and evidence outrank physiological advice on purpose. A commander
 * who cannot see a firefighter cannot act on anything else said about them, and
 * an SCBA at reserve is a clock the fireground does not negotiate with.
 */
const PRIORITY = {
  withdraw: 10,
  restore_scba: 20,
  medical_review: 30,
  rotate: 40,
  check_sensor: 50,
  insufficient_data: 55,
  preposition_relief: 60,
  monitor: 90,
} as const satisfies Record<RecommendationType, number>;

export type RecommendationContext = {
  callsign: string;
  /** Minutes until the fire puts them past a threshold, if known. */
  minutesToDanger?: number | null;
  minutesToCaution?: number | null;
  /** SCBA remaining, percent, when reported. */
  scbaPressurePct?: number | null;
  /** True when the reported position is inside the fire perimeter. */
  insidePerimeter?: boolean;
};

export type GeneratedRecommendation = {
  type: RecommendationType;
  priorityRank: number;
  rationale: string;
  suggestedAction: string;
  alternatives: string[];
  /** Never exceeds the confidence of the assessment it came from. */
  confidence: "high" | "medium" | "low";
};

function driversPhrase(assessment: RiskAssessment): string {
  const drivers = assessment.topDrivers.slice(0, 3);
  return drivers.length === 0 ? "no single dominant driver" : drivers.join(", ");
}

/**
 * Generate advice for one firefighter, most urgent first.
 *
 * Returns an empty array when there is genuinely nothing to say. A SAFE
 * firefighter with clean data needs no advice, and manufacturing some would
 * train commanders to ignore the feed — which is how a safety system gets muted.
 */
export function recommendFor(
  assessment: RiskAssessment,
  context: RecommendationContext,
): GeneratedRecommendation[] {
  const out: GeneratedRecommendation[] = [];

  // Rule 2: advice is only ever as good as the evidence under it.
  const confidence = assessment.dataQuality.confidence;
  const band: RiskBand = assessment.band;
  const severity = BAND_SEVERITY[band];
  const drivers = driversPhrase(assessment);

  const caveat =
    confidence === "low"
      ? " Data quality is LOW — treat this as a prompt to verify, not as a finding."
      : confidence === "medium"
        ? " Data quality is medium."
        : "";

  const push = (r: Omit<GeneratedRecommendation, "priorityRank" | "confidence">): void => {
    out.push({ ...r, priorityRank: PRIORITY[r.type], confidence });
  };

  /* --- Equipment and evidence first -------------------------------------- */

  const scba = context.scbaPressurePct;
  if (typeof scba === "number" && Number.isFinite(scba) && scba <= SCBA_PREPOSITION_PCT) {
    push({
      type: "restore_scba",
      rationale:
        `${context.callsign} is at ${Math.round(scba)}% SCBA. ` +
        `Air is a hard clock and does not negotiate.${caveat}`,
      suggestedAction:
        "Move to air replenishment now, or confirm a relief is already on the way.",
      alternatives: [
        "Confirm a second set is staged within reach",
        "Rotate the whole crew rather than one member",
      ],
    });
  }

  const missing = assessment.dataQuality.missingInputs ?? [];
  if (missing.length > 0) {
    push({
      type: "check_sensor",
      rationale:
        `No current reading for ${missing.join(", ")} on ${context.callsign}. ` +
        `Missing inputs are scored at worst case, so the band shown is a floor, ` +
        `not an estimate.${caveat}`,
      suggestedAction: `Confirm ${context.callsign} by voice and check the affected sensor.`,
      alternatives: [
        "Task the nearest crew member to confirm visually",
        "Accept the degraded picture and shorten the check-in interval",
      ],
    });
  }

  if (band === "UNKNOWN") {
    /*
      Rule 3. Not knowing is actionable, and it is NOT a reason to withdraw.
      Withdrawing on absent data teaches crews that the system panics; staying
      silent teaches them a dead sensor is fine. "Find out" is the honest advice.
    */
    push({
      type: "insufficient_data",
      rationale:
        `The engine cannot place ${context.callsign}. This is a gap in evidence — ` +
        `it is not a finding of safety and not a finding of danger.${caveat}`,
      suggestedAction:
        "Re-establish contact and restore the missing channel before relying on any band for this firefighter.",
      alternatives: [
        "Hold position and re-assess on the next reading",
        "Treat as CAUTION by policy until the picture is restored",
      ],
    });
  }

  /* --- Physiological and positional -------------------------------------- */

  if (assessment.hardOverride) {
    push({
      type: "withdraw",
      rationale:
        `Hard override on ${context.callsign}: ${assessment.hardOverrideReasons.join("; ")}. ` +
        `This bypasses the composite score deliberately.${caveat}`,
      suggestedAction: "Withdraw to a safe area and hand over to a medic.",
      alternatives: [
        "Withdraw to the nearest rehab point if it is closer than the muster area",
        "Send a partner rather than moving them unaccompanied",
      ],
    });
  } else if (severity >= BAND_SEVERITY.CRITICAL) {
    push({
      type: "withdraw",
      rationale: `${context.callsign} is CRITICAL, driven by ${drivers}.${caveat}`,
      suggestedAction: "Withdraw to a safe area.",
      alternatives: ["Rotate immediately if a relief is already in position"],
    });
  } else if (severity >= BAND_SEVERITY.HIGH) {
    push({
      type: "rotate",
      rationale: `${context.callsign} is HIGH, driven by ${drivers}.${caveat}`,
      suggestedAction: "Rotate out at the next safe opportunity.",
      alternatives: [
        "Reduce workload in place and re-assess in five minutes",
        "Move them further from the front without standing them down",
      ],
    });
  }

  const clinicalDriver = assessment.topDrivers.some((d) =>
    /core temp|glucose|heat|spo2/i.test(d),
  );
  if (clinicalDriver && severity >= BAND_SEVERITY.HIGH) {
    push({
      type: "medical_review",
      rationale:
        `${context.callsign}'s picture is led by ${drivers}, which a medic should ` +
        `see rather than a commander alone.${caveat}`,
      suggestedAction: "Have a medic assess before returning them to the line.",
      alternatives: ["Rehab and re-assess if no medic is available on scene"],
    });
  }

  if (context.insidePerimeter === true) {
    push({
      type: "withdraw",
      rationale:
        `${context.callsign}'s reported position is inside the fire perimeter, so ` +
        `their escape route cannot be assumed clear.${caveat}`,
      suggestedAction: "Confirm position and route out immediately.",
      alternatives: [
        "Verify the position fix before acting — a stale fix looks exactly like this",
      ],
    });
  }

  /* --- Forward-looking ---------------------------------------------------- */

  const toDanger = context.minutesToDanger;
  if (
    typeof toDanger === "number" &&
    Number.isFinite(toDanger) &&
    toDanger > 0 &&
    toDanger <= PREPOSITION_HORIZON_MIN &&
    severity < BAND_SEVERITY.HIGH
  ) {
    push({
      type: "preposition_relief",
      rationale:
        `${context.callsign} is not in trouble now, but on the current spread they ` +
        `cross into DANGER in about ${toDanger} minutes if they hold this position.${caveat}`,
      suggestedAction: "Stage a relief now rather than after the band moves.",
      alternatives: [
        "Reposition them further out and keep them on task",
        "Accept and re-assess — the projection assumes they do not move",
      ],
    });
  }

  /* --- Nothing louder than this ------------------------------------------- */

  if (out.length === 0 && band === "CAUTION") {
    push({
      type: "monitor",
      rationale: `${context.callsign} is CAUTION, driven by ${drivers}. No action indicated yet.${caveat}`,
      suggestedAction: "Keep them in view and re-assess on the next reading.",
      alternatives: ["Shorten the check-in interval"],
    });
  }

  return out.sort((a, b) => a.priorityRank - b.priorityRank);
}

/**
 * A stable identity for "the same advice, again".
 *
 * The observation feed produces an assessment every few seconds. Without this,
 * a firefighter sitting at HIGH for ten minutes would generate a hundred
 * identical recommendations and the queue would become unreadable — which is
 * how a safety system gets muted.
 */
export function recommendationKey(
  deploymentId: string,
  type: RecommendationType,
): string {
  return `${deploymentId}:${type}`;
}
