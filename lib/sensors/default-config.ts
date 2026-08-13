import rawPurpleAirConfig from "../../config/purpleair-default.json";
import { loadPurpleAirConfig, type PurpleAirConfig } from "./purpleair-config";

export const DEFAULT_PURPLEAIR_CONFIG: PurpleAirConfig =
  loadPurpleAirConfig(rawPurpleAirConfig);
