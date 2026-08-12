/**
 * Loads and validates the shipped default configuration.
 *
 * Kept separate from the engine so that `lib/risk/engine.ts` stays free of any
 * file, bundler or framework coupling.
 */

import rawDefaultConfig from "../../config/risk-default.json";
import rawSharedConfig from "../../config/shared-default.json";
import { loadSharedConfig, sharedParameterMap } from "../params/shared";
import { loadRiskConfig, type RiskConfig } from "./config";

/** Shared quantities used by both the risk engine and the physiology models. */
export const DEFAULT_SHARED_CONFIG = loadSharedConfig(rawSharedConfig);

export const DEFAULT_RISK_CONFIG: RiskConfig = loadRiskConfig(
  rawDefaultConfig,
  sharedParameterMap(DEFAULT_SHARED_CONFIG),
);
