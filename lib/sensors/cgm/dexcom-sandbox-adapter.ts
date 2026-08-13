/**
 * Dexcom SANDBOX adapter.
 *
 * SANDBOX ONLY. `baseUrl` is `https://sandbox-api.dexcom.com` and the production
 * host does not appear anywhere in this file. The sandbox mirrors every
 * production endpoint with simulated data and requires no approval, so the real
 * integration shape is developed now and the base URL swapped later.
 *
 * WHAT THIS IS NOT:
 *  - not an integration with Dexcom (it is an integration with their sandbox)
 *  - not real-time (`isRealTime` is false and cannot be set true here)
 *  - not real patient data (sandbox data is vendor-simulated, hence Tier C)
 *
 * API latency for reference, surfaced so a commander can see it:
 *   sandbox              0 min
 *   standard, US        60 min
 *   standard, UK       180 min
 *   real-time partner    5 min   ← requires partner status Valoris does not have
 *
 * Even at zero API latency the physiological interstitial lag of 5-15 minutes
 * remains, so a sandbox reading is still 5-15 minutes behind blood glucose.
 *
 * This adapter performs NO network call unless `connect` has been given a real
 * token, and it is never exercised against the network in tests or demos.
 */

import type {
  AdapterHealth,
  CgmAdapter,
  GlucoseReading,
  GlucoseTrend,
  OAuthToken,
} from "./types";

const SANDBOX_BASE_URL = "https://sandbox-api.dexcom.com";

/** Sandbox users published by Dexcom. SandboxUser7 returns G7 data. */
export const DEXCOM_SANDBOX_USERS = [
  "SandboxUser1",
  "SandboxUser2",
  "SandboxUser6",
  "SandboxUser7",
] as const;

const MG_DL_PER_MMOL_L = 18.0182;

/** Dexcom reports mg/dL; Valoris is mmol/L throughout. */
export function mgDlToMmolL(mgDl: number): number {
  return mgDl / MG_DL_PER_MMOL_L;
}

const TREND_MAP: Record<string, GlucoseTrend> = {
  doubleUp: "doubleUp",
  singleUp: "singleUp",
  fortyFiveUp: "fortyFiveUp",
  flat: "flat",
  fortyFiveDown: "fortyFiveDown",
  singleDown: "singleDown",
  doubleDown: "doubleDown",
  none: "notComputable",
  notComputable: "notComputable",
  rateOutOfRange: "notComputable",
};

export type DexcomEgvRecord = {
  recordId?: string;
  systemTime?: string;
  displayTime?: string;
  value?: number | null;
  trend?: string;
  trendRate?: number | null;
  unit?: string;
};

export type DexcomSandboxConfig = {
  /** Sandbox user to read. Sandbox login requires no password. */
  sandboxUser?: (typeof DEXCOM_SANDBOX_USERS)[number];
  /** Injected for testing; defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Clock, injected so the adapter stays deterministic under test. */
  nowMs?: () => number;
};

export class DexcomSandboxAdapter implements CgmAdapter {
  readonly vendor = "dexcom" as const;
  /** Never true. Real-time access requires partner status Valoris lacks. */
  readonly isRealTime = false;
  /** Sandbox has no transport delay. The physiological lag still applies. */
  readonly latencySec = 0;
  readonly baseUrl = SANDBOX_BASE_URL;

  private token: OAuthToken | null = null;
  private lastSuccessfulPollMs: number | null = null;
  private consecutiveFailures = 0;
  private readonly config: DexcomSandboxConfig;

  constructor(config: DexcomSandboxConfig = {}) {
    this.config = config;
  }

  private now(): number {
    return this.config.nowMs?.() ?? Date.now();
  }

  async connect(auth: OAuthToken): Promise<void> {
    if (auth.accessToken.trim() === "") {
      throw new Error("Dexcom sandbox adapter: an access token is required");
    }
    this.token = auth;
  }

  health(): AdapterHealth {
    if (this.token === null) {
      return {
        available: false,
        unavailableReason:
          "Not connected. Register at developer.dexcom.com for immediate free sandbox access, then call connect() with the OAuth token. Valoris has no Dexcom partner status and no real-time access.",
        lastSuccessfulPollMs: null,
        consecutiveFailures: this.consecutiveFailures,
      };
    }
    if (this.token.expiresAtMs <= this.now()) {
      return {
        available: false,
        unavailableReason: "OAuth token has expired; refresh required.",
        lastSuccessfulPollMs: this.lastSuccessfulPollMs,
        consecutiveFailures: this.consecutiveFailures,
      };
    }
    return {
      available: true,
      unavailableReason: "",
      lastSuccessfulPollMs: this.lastSuccessfulPollMs,
      consecutiveFailures: this.consecutiveFailures,
    };
  }

  /** Maps one Dexcom EGV record onto the vendor-agnostic reading. */
  toReading(record: DexcomEgvRecord, receivedAtMs: number): GlucoseReading | null {
    if (record.value === null || record.value === undefined) return null;
    const recordedAtMs = Date.parse(
      record.systemTime ?? record.displayTime ?? "",
    );
    if (Number.isNaN(recordedAtMs)) return null;

    // Dexcom reports mg/dL unless told otherwise. Unit confusion in this domain
    // is a real-world killer, so the conversion is explicit and one-way.
    const valueMmolL =
      record.unit === "mmol/L" ? record.value : mgDlToMmolL(record.value);

    return {
      valueMmolL,
      trend: TREND_MAP[record.trend ?? "notComputable"] ?? "notComputable",
      trendRateMmolLPerMin:
        record.trendRate === null || record.trendRate === undefined
          ? null
          : record.unit === "mmol/L"
            ? record.trendRate
            : mgDlToMmolL(record.trendRate),
      recordedAtMs,
      receivedAtMs,
      latencySec: Math.max(0, (receivedAtMs - recordedAtMs) / 1000),
      vendor: this.vendor,
      // Sandbox data is vendor-simulated, so it is Tier C — never Tier A, and
      // not Tier B either, because no real person generated it.
      dataTier: "C_SYNTHETIC_MODEL_DRIVEN",
      isSandbox: true,
    };
  }

  async getReadings(from: Date, to: Date): Promise<GlucoseReading[]> {
    const health = this.health();
    if (!health.available) {
      throw new Error(`Dexcom sandbox adapter unavailable: ${health.unavailableReason}`);
    }
    const token = this.token as OAuthToken;
    const doFetch = this.config.fetchImpl ?? fetch;

    const url = `${this.baseUrl}/v3/users/self/egvs?startDate=${encodeURIComponent(
      from.toISOString(),
    )}&endDate=${encodeURIComponent(to.toISOString())}`;

    try {
      const response = await doFetch(url, {
        headers: { Authorization: `Bearer ${token.accessToken}` },
      });
      if (!response.ok) {
        this.consecutiveFailures += 1;
        throw new Error(`Dexcom sandbox returned ${response.status}`);
      }
      const body = (await response.json()) as { records?: DexcomEgvRecord[] };
      const receivedAtMs = this.now();
      const readings = (body.records ?? [])
        .map((r) => this.toReading(r, receivedAtMs))
        .filter((r): r is GlucoseReading => r !== null);
      this.lastSuccessfulPollMs = receivedAtMs;
      this.consecutiveFailures = 0;
      return readings;
    } catch (error) {
      this.consecutiveFailures += 1;
      throw error instanceof Error ? error : new Error(String(error));
    }
  }
}
