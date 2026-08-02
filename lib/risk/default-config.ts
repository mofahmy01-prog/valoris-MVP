/**
 * Loads and validates the shipped default configuration.
 *
 * Kept separate from the engine so that `lib/risk/engine.ts` stays free of any
 * file, bundler or framework coupling.
 */

import rawDefaultConfig from "../../config/risk-default.json";
import { loadRiskConfig, type RiskConfig } from "./config";

export const DEFAULT_RISK_CONFIG: RiskConfig = loadRiskConfig(rawDefaultConfig);
