/**
 * Shared parameters — quantities used by more than one model.
 *
 * A physical quantity must have exactly one value. When the risk engine and the
 * physiology models both need "how much gets past the mask", holding that in two
 * config files guarantees they eventually disagree — and they did, by a factor
 * of five, until this module existed.
 *
 * Rules enforced by the loader:
 *  - a shared name may not be redefined in a model config (no shadowing)
 *  - every model that uses a shared name gets the identical `ConfigParameter`
 *    object, so the value, provenance and rationale travel together
 */

import {
  loadNamedParameters,
  type ConfigParameter,
  type LoadedParameters,
} from "./parameters";

export const SHARED_PARAM_NAMES = ["scba_inhaled_fraction_on_air"] as const;

export type SharedParamName = (typeof SHARED_PARAM_NAMES)[number];

export type SharedConfig = LoadedParameters<SharedParamName>;

export function loadSharedConfig(raw: unknown): SharedConfig {
  return loadNamedParameters("shared config", raw, SHARED_PARAM_NAMES);
}

/** The shared parameters as a plain record, for passing into a model loader. */
export function sharedParameterMap(
  config: SharedConfig,
): Record<string, ConfigParameter> {
  const out: Record<string, ConfigParameter> = {};
  for (const name of SHARED_PARAM_NAMES) out[name] = config.parameters[name];
  return out;
}
