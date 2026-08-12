/**
 * Heat strain — the heat-balance core of ISO 7933 Predicted Heat Strain,
 * REDUCED.
 *
 * WHAT THIS IS. A single-step heat balance: metabolic heat in, convection,
 * radiation and respiration out, the evaporation required to close the gap, the
 * evaporation the environment and clothing actually permit, and the two limits
 * that bound safe exposure — cumulative water loss and core temperature rise.
 *
 * WHAT THIS IS NOT. A conformant ISO 7933 implementation. It omits:
 *   - the standard's minute-by-minute iterative integration with feedback
 *     between skin temperature, wettedness and sweat rate
 *   - the dynamic clothing adjustment sub-model (static vs. dynamic insulation,
 *     pumping effects from body movement, wind correction of insulation)
 *   - the standard's separate acclimatised and unacclimatised branches beyond
 *     two sweat-rate and water-loss limits
 *   - mean skin temperature prediction — it is held at a configured constant
 *   - equilibrium checks and the standard's convergence criteria
 *
 * Its output must never be labelled an ISO 7933 result. It is labelled
 * `iso7933_phs_reduced_v1` everywhere it appears.
 *
 * Pure. No imports beyond config and types.
 */

import { physParam, type PhysiologyConfig } from "./config";
import type {
  HeatStrain,
  HeatStrainLimiter,
  ModelProvenance,
  Subject,
  WorkContext,
} from "./types";

const MODEL_KEY = "iso7933_phs_reduced_v1";
const MODEL_LABEL =
  "Reduced ISO 7933 PHS heat balance (illustrative — NOT a conformant ISO 7933 implementation)";

/** Numerical guards, not clinical thresholds. */
const CLO_TO_M2K_W = 0.155;
const REFERENCE_AIR_VELOCITY_MS = 0.3;
const SECONDS_PER_HOUR = 3600;
/** Latent heat of vaporisation of sweat, Wh per gram. */
const LATENT_HEAT_WH_PER_G = 0.68;
const MIN_HUMIDITY_PCT = 0;
const MAX_HUMIDITY_PCT = 100;

function clamp(value: number, lo: number, hi: number): number {
  if (!Number.isFinite(value)) return lo;
  return value < lo ? lo : value > hi ? hi : value;
}

/**
 * Saturated water vapour pressure in kPa, Magnus formula. Pure arithmetic, no
 * clinical content.
 */
export function saturatedVapourPressureKpa(tempC: number): number {
  return 0.6105 * Math.exp((17.27 * tempC) / (237.7 + tempC));
}

export function ambientVapourPressureKpa(
  ambientTempC: number,
  humidityPct: number,
): number {
  const rh = clamp(humidityPct, MIN_HUMIDITY_PCT, MAX_HUMIDITY_PCT) / 100;
  return saturatedVapourPressureKpa(ambientTempC) * rh;
}

/** Personalised core temperature ceiling used for the duration limit. */
export function personalCoreTempLimitC(
  subject: Subject,
  config: PhysiologyConfig,
): number {
  const shift = physParam(config, "heat_tolerance_core_limit_shift_c");
  const step =
    subject.heatTolerance === "low" ? -1 : subject.heatTolerance === "high" ? 1 : 0;
  return physParam(config, "phs_core_temp_limit_c") + step * shift;
}

export type HeatStrainInput = {
  subject: Subject;
  context: WorkContext;
  /** Inferred from cardiac strain — see cardiac.inferMetabolicRateWm2. */
  metabolicRateWm2: number;
  /** Current estimated core temperature, °C. Used for the core-temp limit. */
  currentCoreTempC: number;
};

export function assessHeatStrain(
  input: HeatStrainInput,
  config: PhysiologyConfig,
): HeatStrain {
  const { subject, context, metabolicRateWm2 } = input;
  const caveats: string[] = [
    "Reduced implementation of the ISO 7933 heat-balance core. Not a conformant ISO 7933 result and must not be presented as one.",
    "Mean skin temperature is held at a configured constant rather than predicted iteratively.",
  ];

  const acclimatised = subject.heatAcclimatised === true;
  const bodyMassKg =
    subject.bodyMassKg ?? physParam(config, "body_mass_kg_default");
  const surfaceAreaM2 =
    subject.bodySurfaceAreaM2 ?? physParam(config, "body_surface_area_m2_default");
  if (subject.bodyMassKg === undefined || subject.bodyMassKg === null) {
    caveats.push(
      "Body mass not supplied; the population default is used, which biases heat storage per kilogram.",
    );
  }

  // Missing environment is never treated as comfortable. Absent ambient
  // temperature is taken at the skin temperature, which removes convective and
  // radiative cooling entirely; absent humidity is taken as saturated, which
  // removes evaporative capacity.
  const skinTempC = physParam(config, "skin_temp_c");
  let ambientTempC = context.ambientTempC;
  if (ambientTempC === null) {
    ambientTempC = skinTempC;
    caveats.push(
      "Ambient temperature unavailable — assumed equal to skin temperature, removing all convective and radiative cooling.",
    );
  }
  let humidityPct = context.humidityPct;
  if (humidityPct === null) {
    humidityPct = MAX_HUMIDITY_PCT;
    caveats.push(
      "Humidity unavailable — assumed saturated, removing evaporative capacity.",
    );
  }
  const meanRadiantTempC = context.meanRadiantTempC ?? ambientTempC;
  if (context.meanRadiantTempC === null || context.meanRadiantTempC === undefined) {
    caveats.push(
      "No radiant temperature reported; ambient is substituted. Near a flame front this understates radiant load substantially.",
    );
  }

  const airVelocityMs =
    context.airVelocityMs ?? physParam(config, "air_velocity_ms_default");
  const velocityFactor = Math.pow(
    Math.max(airVelocityMs, 0.05) / REFERENCE_AIR_VELOCITY_MS,
    physParam(config, "air_velocity_exponent"),
  );

  const cloM2KW =
    (context.wearingPpe
      ? physParam(config, "clothing_insulation_clo_ppe")
      : physParam(config, "clothing_insulation_clo_no_ppe")) * CLO_TO_M2K_W;

  const evaporativeResistance = context.wearingPpe
    ? physParam(config, "evaporative_resistance_m2kpa_w_ppe")
    : physParam(config, "evaporative_resistance_m2kpa_w_no_ppe");

  // Clothing reduces the effective transfer coefficients.
  const hc = physParam(config, "convective_coeff_w_m2k") * velocityFactor;
  const hr = physParam(config, "radiative_coeff_w_m2k");
  const clothingFactor = 1 / (1 + cloM2KW * (hc + hr));

  const convectiveWm2 = hc * clothingFactor * (ambientTempC - skinTempC);
  const radiativeWm2 = hr * clothingFactor * (meanRadiantTempC - skinTempC);

  // Respiratory losses scale with metabolic rate.
  const ambientPaKpa = ambientVapourPressureKpa(ambientTempC, humidityPct);
  const respiratoryEvapWm2 =
    physParam(config, "respiratory_evaporative_coeff") *
    metabolicRateWm2 *
    (physParam(config, "skin_vapour_pressure_kpa") - ambientPaKpa);
  const respiratoryConvWm2 =
    physParam(config, "respiratory_convective_coeff") *
    metabolicRateWm2 *
    (skinTempC - ambientTempC);
  const respiratoryWm2 = respiratoryEvapWm2 + respiratoryConvWm2;

  const metabolicHeatWm2 =
    metabolicRateWm2 * (1 - physParam(config, "work_efficiency_fraction"));

  // Evaporation needed to hold thermal balance.
  const requiredEvaporationWm2 =
    metabolicHeatWm2 + convectiveWm2 + radiativeWm2 - respiratoryWm2;

  // Evaporation the environment and clothing permit at full skin wettedness.
  const vapourGradientKpa =
    physParam(config, "skin_vapour_pressure_kpa") - ambientPaKpa;
  const maxEvaporationWm2 = Math.max(
    0,
    vapourGradientKpa / (evaporativeResistance / Math.max(velocityFactor, 0.1)),
  );

  const requiredWettedness =
    maxEvaporationWm2 <= 0
      ? requiredEvaporationWm2 > 0
        ? Number.POSITIVE_INFINITY
        : 0
      : Math.max(0, requiredEvaporationWm2) / maxEvaporationWm2;

  // Efficiency falls as the skin wets. ISO 7933 uses r = 1 − w²/2; the
  // configured constant is that value at w = 1.
  const efficiencyAtFull = physParam(
    config,
    "evaporative_efficiency_at_full_wettedness",
  );
  const wettedness = clamp(requiredWettedness, 0, 1);
  const evaporativeEfficiency = 1 - (1 - efficiencyAtFull) * wettedness * wettedness;

  const requiredSweatWm2 =
    evaporativeEfficiency <= 0
      ? Number.POSITIVE_INFINITY
      : Math.max(0, requiredEvaporationWm2) / evaporativeEfficiency;

  const wm2ToGPerHour = (wm2: number): number =>
    (wm2 * surfaceAreaM2) / LATENT_HEAT_WH_PER_G;

  const requiredSweatRateGPerHour = Number.isFinite(requiredSweatWm2)
    ? wm2ToGPerHour(requiredSweatWm2)
    : Number.POSITIVE_INFINITY;

  const maxSweatRateGPerHour = acclimatised
    ? physParam(config, "max_sweat_rate_g_per_hour_acclimatised")
    : physParam(config, "max_sweat_rate_g_per_hour_unacclimatised");

  const predictedSweatRateGPerHour = Math.min(
    requiredSweatRateGPerHour,
    maxSweatRateGPerHour,
  );

  // Evaporation actually achieved, given the sweat that can be produced and the
  // ceiling the environment imposes.
  const achievedEvaporationWm2 = Math.min(
    maxEvaporationWm2,
    ((predictedSweatRateGPerHour * LATENT_HEAT_WH_PER_G) / surfaceAreaM2) *
      evaporativeEfficiency,
  );

  const heatStorageWm2 = requiredEvaporationWm2 - achievedEvaporationWm2;

  if (requiredSweatRateGPerHour > maxSweatRateGPerHour) {
    caveats.push(
      "Required sweat rate exceeds the achievable maximum, so heat accumulates regardless of hydration.",
    );
  }

  /* --- Duration limits --------------------------------------------------- */

  const horizonMin = physParam(config, "dlim_horizon_min");

  const maxWaterLossG = acclimatised
    ? physParam(config, "max_water_loss_g_acclimatised")
    : physParam(config, "max_water_loss_g_unacclimatised");

  const dlimWaterLossMinRaw =
    predictedSweatRateGPerHour <= 0
      ? Number.POSITIVE_INFINITY
      : (maxWaterLossG / predictedSweatRateGPerHour) * 60;

  const coreTempLimitC = personalCoreTempLimitC(subject, config);
  const headroomC = coreTempLimitC - input.currentCoreTempC;
  // Wh of heat storage needed to raise the whole body by the remaining headroom.
  const storageCapacityWh =
    Math.max(0, headroomC) *
    bodyMassKg *
    physParam(config, "specific_heat_body_wh_per_kg_c");
  const storageRateW = heatStorageWm2 * surfaceAreaM2;
  const dlimCoreTempMinRaw =
    storageRateW <= 0
      ? Number.POSITIVE_INFINITY
      : (storageCapacityWh / storageRateW) * 60;

  const withinHorizon = (minutes: number): number | null =>
    Number.isFinite(minutes) && minutes <= horizonMin
      ? Math.round(minutes * 10) / 10
      : null;

  const dlimWaterLossMin = withinHorizon(dlimWaterLossMinRaw);
  const dlimCoreTempMin = withinHorizon(dlimCoreTempMinRaw);

  let dlimMin: number | null = null;
  let limiter: HeatStrainLimiter = "none_within_horizon";
  if (dlimCoreTempMin !== null && dlimWaterLossMin !== null) {
    if (dlimCoreTempMin <= dlimWaterLossMin) {
      dlimMin = dlimCoreTempMin;
      limiter = "core_temperature";
    } else {
      dlimMin = dlimWaterLossMin;
      limiter = "water_loss";
    }
  } else if (dlimCoreTempMin !== null) {
    dlimMin = dlimCoreTempMin;
    limiter = "core_temperature";
  } else if (dlimWaterLossMin !== null) {
    dlimMin = dlimWaterLossMin;
    limiter = "water_loss";
  }

  if (headroomC <= 0 && storageRateW > 0) {
    caveats.push(
      "Estimated core temperature is already at or above its personalised limit; allowable duration is reported as zero.",
    );
  }

  const provenance: ModelProvenance = {
    modelKey: MODEL_KEY,
    modelLabel: MODEL_LABEL,
    estimated: true,
    caveats,
    modelVersion: config.modelVersion,
    configHash: config.configHash,
  };

  const finite = (value: number): number =>
    Number.isFinite(value) ? Math.round(value * 10) / 10 : Number.POSITIVE_INFINITY;

  return {
    metabolicRateWm2: finite(metabolicRateWm2),
    convectiveWm2: finite(convectiveWm2),
    radiativeWm2: finite(radiativeWm2),
    respiratoryWm2: finite(respiratoryWm2),
    requiredEvaporationWm2: finite(requiredEvaporationWm2),
    maxEvaporationWm2: finite(maxEvaporationWm2),
    requiredWettedness: Number.isFinite(requiredWettedness)
      ? Math.round(requiredWettedness * 100) / 100
      : Number.POSITIVE_INFINITY,
    requiredSweatRateGPerHour: finite(requiredSweatRateGPerHour),
    predictedSweatRateGPerHour: finite(predictedSweatRateGPerHour),
    heatStorageWm2: finite(heatStorageWm2),
    dlimWaterLossMin,
    dlimCoreTempMin,
    dlimMin,
    limiter,
    coreTempLimitC: Math.round(coreTempLimitC * 100) / 100,
    provenance,
  };
}

/** Heat storage converted to a core temperature rise over `minutes`. */
export function heatStorageToCoreTempRiseC(
  heatStorageWm2: number,
  surfaceAreaM2: number,
  bodyMassKg: number,
  minutes: number,
  config: PhysiologyConfig,
): number {
  const storageWh = (heatStorageWm2 * surfaceAreaM2 * minutes * 60) / SECONDS_PER_HOUR;
  const heatCapacityWhPerC =
    bodyMassKg * physParam(config, "specific_heat_body_wh_per_kg_c");
  return heatCapacityWhPerC <= 0 ? 0 : storageWh / heatCapacityWhPerC;
}
