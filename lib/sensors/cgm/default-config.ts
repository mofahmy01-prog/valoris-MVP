import rawDiabetesConfig from "../../../config/risk-diabetes.json";
import { loadDiabetesConfig, type DiabetesConfig } from "./config";

export const DEFAULT_DIABETES_CONFIG: DiabetesConfig =
  loadDiabetesConfig(rawDiabetesConfig);
