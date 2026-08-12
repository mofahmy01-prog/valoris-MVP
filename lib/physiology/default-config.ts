import rawPhysiologyConfig from "../../config/physiology-default.json";
import rawSharedConfig from "../../config/shared-default.json";
import { loadSharedConfig, sharedParameterMap } from "../params/shared";
import { loadPhysiologyConfig, type PhysiologyConfig } from "./config";

/**
 * The same shared config the risk engine loads. Both models therefore see the
 * identical `ConfigParameter` object for any shared quantity — they cannot hold
 * two values for one physical thing.
 */
export const DEFAULT_PHYSIOLOGY_CONFIG: PhysiologyConfig = loadPhysiologyConfig(
  rawPhysiologyConfig,
  sharedParameterMap(loadSharedConfig(rawSharedConfig)),
);
