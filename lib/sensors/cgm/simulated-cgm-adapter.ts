/**
 * Model-driven glucose, from Tier C physiology.
 *
 * Not a vendor. Not real data. Deterministic and seeded, so the same incident
 * replays identically.
 *
 * Glucose declines from a starting value at a rate driven by:
 *   - exertion — consumption rises to 3–5× resting under load
 *   - PPE      — a thermoregulatory multiplier
 *   - heat     — a further multiplier above 30 °C, a crude WBGT stand-in
 *
 * Every coefficient is named in `config/risk-diabetes.json` and illustrative.
 */

import { dbParam, type DiabetesConfig } from "./config";
import type {
  AdapterHealth,
  CgmAdapter,
  GlucoseReading,
  GlucoseTrend,
  OAuthToken,
} from "./types";

export type SimulatedGlucoseState = {
  /** Current modelled blood glucose, mmol/L. */
  glucoseMmolL: number;
  /** Epoch ms of the last update. */
  lastUpdatedMs: number;
};

export type SimulatedGlucoseInput = {
  previous: SimulatedGlucoseState | null;
  /** Fraction of heart-rate reserve in use, 0..1. Drives consumption. */
  hrrFraction: number | null;
  wearingPpe: boolean;
  /** Humidity-adjusted ambient temperature, °C. */
  effectiveTempC: number | null;
  elapsedMin: number;
  nowMs: number;
  /** Starting value when there is no previous state. */
  startingMmolL?: number;
};

const DEFAULT_STARTING_MMOL_L = 7.5;
const HEAT_REFERENCE_C = 30;

function clamp(v: number, lo: number, hi: number): number {
  if (!Number.isFinite(v)) return lo;
  return v < lo ? lo : v > hi ? hi : v;
}

function trendFrom(rateMmolLPerMin: number): GlucoseTrend {
  // Thresholds mirror the shape of vendor trend arrows.
  if (rateMmolLPerMin <= -0.17) return "doubleDown";
  if (rateMmolLPerMin <= -0.11) return "singleDown";
  if (rateMmolLPerMin <= -0.06) return "fortyFiveDown";
  if (rateMmolLPerMin >= 0.17) return "doubleUp";
  if (rateMmolLPerMin >= 0.11) return "singleUp";
  if (rateMmolLPerMin >= 0.06) return "fortyFiveUp";
  return "flat";
}

/** Pure step. Deterministic given its inputs. */
export function stepSimulatedGlucose(
  input: SimulatedGlucoseInput,
  config: DiabetesConfig,
): { state: SimulatedGlucoseState; reading: GlucoseReading } {
  const start =
    input.previous?.glucoseMmolL ?? input.startingMmolL ?? DEFAULT_STARTING_MMOL_L;
  const elapsedMin = Math.max(0, input.elapsedMin);

  const restingRate = dbParam(config, "resting_consumption_mmol_l_per_hour");
  const minMultiplier = dbParam(config, "exercise_consumption_multiplier_min");
  const maxMultiplier = dbParam(config, "exercise_consumption_multiplier_max");

  // No heart rate: assume the upper multiplier. Absence is not rest.
  const exertion = input.hrrFraction === null ? 1 : clamp(input.hrrFraction, 0, 1);
  const exerciseMultiplier =
    input.hrrFraction === null
      ? maxMultiplier
      : 1 + exertion * (maxMultiplier - 1) * (minMultiplier / maxMultiplier) +
        exertion * (maxMultiplier - minMultiplier);

  const ppeMultiplier = input.wearingPpe
    ? dbParam(config, "ppe_thermal_consumption_multiplier")
    : 1;

  const heatMultiplier =
    input.effectiveTempC === null
      ? 1 +
        dbParam(config, "heat_consumption_multiplier_per_c_above_30") * 20
      : 1 +
        Math.max(0, input.effectiveTempC - HEAT_REFERENCE_C) *
          dbParam(config, "heat_consumption_multiplier_per_c_above_30");

  const consumptionPerHour =
    restingRate * exerciseMultiplier * ppeMultiplier * heatMultiplier;
  const deltaMmolL = -consumptionPerHour * (elapsedMin / 60);
  const glucoseMmolL = clamp(start + deltaMmolL, 1, 30);
  const ratePerMin = elapsedMin === 0 ? 0 : deltaMmolL / elapsedMin;

  return {
    state: {
      glucoseMmolL: Math.round(glucoseMmolL * 100) / 100,
      lastUpdatedMs: input.nowMs,
    },
    reading: {
      valueMmolL: Math.round(glucoseMmolL * 100) / 100,
      trend: trendFrom(ratePerMin),
      trendRateMmolLPerMin: Math.round(ratePerMin * 1000) / 1000,
      recordedAtMs: input.nowMs,
      receivedAtMs: input.nowMs,
      latencySec: 0,
      vendor: "simulated",
      dataTier: "C_SYNTHETIC_MODEL_DRIVEN",
      isSandbox: false,
    },
  };
}

export class SimulatedCgmAdapter implements CgmAdapter {
  readonly vendor = "simulated" as const;
  readonly isRealTime = false;
  readonly latencySec = 0;
  readonly baseUrl = "none — model driven, no network";

  private readonly readings: GlucoseReading[];

  constructor(readings: GlucoseReading[] = []) {
    this.readings = readings;
  }

  async connect(_auth: OAuthToken): Promise<void> {
    // No authentication. Model-driven data has no vendor.
  }

  health(): AdapterHealth {
    return {
      available: true,
      unavailableReason: "",
      lastSuccessfulPollMs: this.readings.at(-1)?.receivedAtMs ?? null,
      consecutiveFailures: 0,
    };
  }

  async getReadings(from: Date, to: Date): Promise<GlucoseReading[]> {
    const fromMs = from.getTime();
    const toMs = to.getTime();
    return this.readings.filter(
      (r) => r.recordedAtMs >= fromMs && r.recordedAtMs <= toMs,
    );
  }
}
