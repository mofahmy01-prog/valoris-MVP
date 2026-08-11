/**
 * Provider registry. The only place the application chooses a fire front source.
 *
 * Swapping providers changes nothing downstream: callers get a `FireFront`, and
 * `distanceToPerimeterM` turns that into the single number the risk engine
 * consumes. `lib/risk/` imports nothing from `lib/fire/`.
 */

import { FarsiteAdapter } from "./farsite-adapter";
import { GeometricSpreadProvider } from "./geometric-spread-provider";
import { HistoricalPerimeterProvider } from "./historical-perimeter-provider";
import type { FireFrontProvider, FireFrontProviderKey } from "./types";

export const DEFAULT_FIRE_PROVIDER_KEY: FireFrontProviderKey =
  "geometric_spread_placeholder";

export function createFireFrontProvider(
  key: FireFrontProviderKey,
): FireFrontProvider {
  switch (key) {
    case "geometric_spread_placeholder":
      return new GeometricSpreadProvider();
    case "farsite_adapter":
      return new FarsiteAdapter();
    case "historical_perimeter":
      return new HistoricalPerimeterProvider();
  }
}

export function listFireFrontProviders(): Array<{
  key: FireFrontProviderKey;
  label: string;
  available: boolean;
  unavailableReason: string;
  isFireBehaviourModel: boolean;
}> {
  const keys: FireFrontProviderKey[] = [
    "geometric_spread_placeholder",
    "farsite_adapter",
    "historical_perimeter",
  ];
  return keys.map((key) => {
    const provider = createFireFrontProvider(key);
    return {
      key,
      label: provider.label,
      available: provider.isAvailable(),
      unavailableReason: provider.unavailableReason(),
      // Valoris models no fire behaviour itself. Only external sources can.
      isFireBehaviourModel: key !== "geometric_spread_placeholder",
    };
  });
}
