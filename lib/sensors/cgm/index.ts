export * from "./types";
export * from "./config";
export * from "./lag-correction";
export * from "./dexcom-sandbox-adapter";
export * from "./simulated-cgm-adapter";
export * from "./abbott-libre-adapter";

import { AbbottLibreAdapter } from "./abbott-libre-adapter";
import { DexcomSandboxAdapter } from "./dexcom-sandbox-adapter";
import { SimulatedCgmAdapter } from "./simulated-cgm-adapter";
import type { CgmAdapter } from "./types";

export type CgmVendorKey = "dexcom_sandbox" | "simulated" | "abbott_libre";

export function createCgmAdapter(key: CgmVendorKey): CgmAdapter {
  switch (key) {
    case "dexcom_sandbox":
      return new DexcomSandboxAdapter();
    case "simulated":
      return new SimulatedCgmAdapter();
    case "abbott_libre":
      return new AbbottLibreAdapter();
  }
}

/** Every adapter with its honest availability, for the UI and /api/health. */
export function listCgmAdapters(): Array<{
  key: CgmVendorKey;
  vendor: string;
  isRealTime: boolean;
  baseUrl: string;
  available: boolean;
  unavailableReason: string;
  accessStatement: string;
}> {
  const statements: Record<CgmVendorKey, string> = {
    dexcom_sandbox:
      "Developed against the Dexcom sandbox API using the production endpoint structure. Real-time CGM access requires Dexcom Partner status, which we have not yet obtained.",
    simulated:
      "Model-driven glucose from the Tier C physiology models. Not a vendor integration and not real data.",
    abbott_libre:
      "Interface stub only. No Abbott Libre client is shipped and no access has been requested.",
  };

  return (["dexcom_sandbox", "simulated", "abbott_libre"] as CgmVendorKey[]).map(
    (key) => {
      const adapter = createCgmAdapter(key);
      const health = adapter.health();
      return {
        key,
        vendor: adapter.vendor,
        isRealTime: adapter.isRealTime,
        baseUrl: adapter.baseUrl,
        available: health.available,
        unavailableReason: health.unavailableReason,
        accessStatement: statements[key],
      };
    },
  );
}
