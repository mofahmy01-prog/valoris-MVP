import rawPhysiologyConfig from "../../config/physiology-default.json";
import { loadPhysiologyConfig, type PhysiologyConfig } from "./config";

export const DEFAULT_PHYSIOLOGY_CONFIG: PhysiologyConfig =
  loadPhysiologyConfig(rawPhysiologyConfig);
