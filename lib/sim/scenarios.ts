/**
 * Named scenarios — the five situations worth being able to reproduce.
 *
 * A demo you have to drive by hand is a demo you cannot repeat, cannot compare
 * against last week, and cannot hand to someone else. These are declarative: a
 * scenario is a list of steps at stated incident times, so the same run produces
 * the same incident and two people can talk about the same thing.
 *
 * Each one exists to exercise a DIFFERENT part of the engine, not to look
 * dramatic:
 *
 *   baseline           nothing happens. The control. If this raises alarms, the
 *                      false-alarm budget is wrong and everything else is noise.
 *   wind_shift         the fire turns on a crew. Exercises proximity, the
 *                      environmental subscore and time-to-threshold.
 *   glucose_fall       BRAVO-1's CGM trends toward hypoglycaemia. Exercises the
 *                      one channel scored only for a monitored firefighter, and
 *                      the hard override that fires for them and nobody else.
 *   asthmatic_in_plume the crew with respiratory risk takes the smoke.
 *                      Exercises personalisation directly: identical air, two
 *                      different answers.
 *   sensor_dropout     hardware fails. Exercises projection, staleness,
 *                      confidence and the never-SAFE rules.
 *
 * SIMULATION MODE — NOT FOR OPERATIONAL USE. These are invented situations, not
 * reconstructions of real incidents.
 */

import type { Callsign, KillableChannel } from "./simulator";
import type { NoiseProfileName } from "@/lib/sensors/noise/engine";

export type ScenarioStep =
  | { atMinute: number; action: "wind_shift" }
  | { atMinute: number; action: "kill_sensor"; callsign: Callsign; channel: KillableChannel }
  | { atMinute: number; action: "restore_sensors"; callsign: Callsign }
  | { atMinute: number; action: "noise"; profile: NoiseProfileName };

export type Scenario = {
  key: string;
  title: string;
  /** What a commander would see, in one sentence. */
  synopsis: string;
  /** What it is testing, in engine terms. Why this scenario earns its place. */
  exercises: string;
  /** What to watch for. The point of running it. */
  expect: string[];
  /** Sensor artefact profile the scenario runs under. */
  noiseProfile: NoiseProfileName;
  steps: ScenarioStep[];
};

export const SCENARIOS: Scenario[] = [
  {
    key: "baseline",
    title: "Baseline — nothing happens",
    synopsis:
      "Six firefighters work a normal deployment. No wind shift, no equipment failure, no medical event.",
    exercises:
      "The false-alarm budget. A monitoring system that cries wolf on a quiet incident will be muted before it is ever needed, so this is the most important scenario and the least interesting to watch.",
    expect: [
      "Bands should stay SAFE or CAUTION for the whole run.",
      "Recommendations should be rare, and none should be a withdrawal.",
      "Any CRITICAL here is a defect, not a demonstration.",
    ],
    noiseProfile: "clean",
    steps: [],
  },
  {
    key: "wind_shift",
    title: "Wind shift — the fire turns on ALPHA",
    synopsis:
      "The wind swings and the front accelerates toward the ALPHA crew, who are working closest to it.",
    exercises:
      "Proximity and environmental subscores, and the time-to-threshold projection. This is the scenario where the map earns its place: the risk arrives before the vitals do.",
    expect: [
      "ALPHA-1 and ALPHA-2 should degrade first, and by position rather than by physiology.",
      "The projection should show DANGER approaching before the band actually moves.",
      "preposition_relief should appear while they are still SAFE — that is the whole point of projecting.",
    ],
    noiseProfile: "clean",
    steps: [{ atMinute: 12, action: "wind_shift" }],
  },
  {
    key: "glucose_fall",
    title: "Glucose fall — BRAVO-1's CGM trends toward hypo",
    synopsis:
      "BRAVO-1 is the only firefighter wearing a CGM. Under load, their glucose falls.",
    exercises:
      "The one channel scored ONLY for a monitored firefighter. Glucose is a critical input for BRAVO-1 and is not scored at all for the other five, so this also demonstrates that an absent CGM does not penalise someone who never wore one.",
    expect: [
      "BRAVO-1 should escalate on a driver none of the others can have.",
      "The hypoglycaemia hard override should fire for BRAVO-1 and for nobody else.",
      "medical_review should be recommended — this is a medic's call, not a commander's.",
    ],
    noiseProfile: "clean",
    steps: [],
  },
  {
    key: "asthmatic_in_plume",
    title: "Asthmatic in the plume — identical air, different answers",
    synopsis:
      "The wind puts smoke over crews that include BRAVO-2, who has moderate asthma, and ALPHA-1, who has no respiratory history.",
    exercises:
      "Personalisation, directly and visibly. Both breathe the same air; the engine scores them against thresholds calibrated to their own respiratory risk, so the same environment produces two different bands.",
    expect: [
      "BRAVO-2 should reach CAUTION or HIGH while ALPHA-1 is still SAFE, on identical environmental inputs.",
      "The rationale should name the respiratory driver rather than a generic score.",
      "This is the clearest demonstration that generic thresholds would have missed one of them.",
    ],
    noiseProfile: "clean",
    steps: [{ atMinute: 10, action: "wind_shift" }],
  },
  {
    key: "sensor_dropout",
    title: "Sensor dropout — the hardware fails",
    synopsis:
      "Sensors misbehave the way real ones do: readings freeze, channels drop, and one crew loses heart rate entirely.",
    exercises:
      "Projection, staleness, confidence degradation and the never-SAFE rules. A dead sensor must never make a firefighter look better than they are.",
    expect: [
      "CHARLIE-1's heart rate should be PROJECTED from their own recent readings, not scored at worst case.",
      "Their band must never read SAFE while a critical channel is imputed.",
      "check_sensor and insufficient_data should be raised — the honest advice is find out, never withdraw.",
      "Confidence should fall, and the projection should expire back to worst case once its horizon passes.",
    ],
    noiseProfile: "degraded",
    steps: [{ atMinute: 8, action: "kill_sensor", callsign: "CHARLIE-1", channel: "hrBpm" }],
  },
];

export function scenarioByKey(key: string): Scenario | undefined {
  return SCENARIOS.find((s) => s.key === key);
}

/** Steps that fall due between two points on the incident clock. */
export function stepsDueBetween(
  scenario: Scenario,
  fromMinuteExclusive: number,
  toMinuteInclusive: number,
): ScenarioStep[] {
  return scenario.steps.filter(
    (s) => s.atMinute > fromMinuteExclusive && s.atMinute <= toMinuteInclusive,
  );
}
