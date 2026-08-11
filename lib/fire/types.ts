/**
 * Fire front abstraction.
 *
 * Valoris does NOT model fire behaviour. Fire spread modelling is a solved,
 * well-funded field — FARSITE, Phoenix RapidFire, and satellite perimeter
 * products already exist and fire agencies already use them. Valoris consumes a
 * fire front from whichever of those sources is available and works out what it
 * means for each individual firefighter. That translation is the product.
 *
 * Consequences enforced by this module's boundary:
 *
 * 1. The risk engine (`lib/risk/`) imports nothing from here. It receives a
 *    `distanceToFireFrontM` and a confidence, and has no idea which provider
 *    produced them. A test asserts this dependency direction.
 * 2. Every front carries provenance and an explicit
 *    `isFireBehaviourPrediction` flag. A placeholder must never be presented as
 *    a scientific prediction.
 *
 * SIMULATION MODE — NOT FOR OPERATIONAL USE.
 */

export type LatLng = { lat: number; lng: number };

/**
 * How much the *front position itself* can be trusted. Distinct from the
 * data-quality confidence attached to a firefighter's sensors.
 */
export type FireFrontConfidence = "high" | "medium" | "low" | "unknown";

export type FireFrontProviderKey =
  | "geometric_spread_placeholder"
  | "farsite_adapter"
  | "historical_perimeter";

export type FireFront = {
  providerKey: FireFrontProviderKey;
  providerLabel: string;

  /** UTC epoch ms the front is valid for. May be in the future for a projection. */
  validAtMs: number;

  /** Closed ring, first point not repeated. WGS84 degrees. */
  perimeter: LatLng[];

  confidence: FireFrontConfidence;

  /**
   * False for anything Valoris computes itself. Only a real fire behaviour
   * model or an observed perimeter may set this true, and the UI must show the
   * distinction.
   */
  isFireBehaviourPrediction: boolean;

  /** Human-readable provenance, shown verbatim in the UI and the report. */
  provenance: string;

  /** True when the front is extrapolated past the last known observation. */
  isProjection: boolean;
};

export type FireFrontQuery = {
  /** UTC epoch ms the caller wants the front for. May be later than `nowMs`. */
  atMs: number;
  /** UTC epoch ms treated as the present. Anything after it is a projection. */
  nowMs: number;
  /** Incident centroid, used by providers that need an origin. */
  origin: LatLng;
  /** Latest observed wind, where the provider uses it. */
  windSpeedMs?: number | null;
  windDirDeg?: number | null;
  /** Ms since the incident started, for time-dependent providers. */
  elapsedMs: number;
};

export interface FireFrontProvider {
  readonly key: FireFrontProviderKey;
  readonly label: string;

  /** False when the provider needs configuration or data it has not been given. */
  isAvailable(): boolean;

  /** Why it is unavailable, for the UI. Empty string when available. */
  unavailableReason(): string;

  getFireFront(query: FireFrontQuery): Promise<FireFront>;
}

export class FireFrontUnavailableError extends Error {
  readonly providerKey: FireFrontProviderKey;

  constructor(providerKey: FireFrontProviderKey, message: string) {
    super(message);
    this.name = "FireFrontUnavailableError";
    this.providerKey = providerKey;
  }
}
