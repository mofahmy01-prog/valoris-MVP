/**
 * Abbott Libre adapter — INTERFACE STUB. DELIBERATELY UNIMPLEMENTED.
 *
 * Abbott Libre will matter as much as Dexcom for UK fire services. This stub
 * exists to prove the interface is genuinely vendor-agnostic: when Libre access
 * is obtained it plugs in here and nothing else in Valoris changes.
 *
 * There is NO LibreView client here, no invented endpoints and no credentials.
 * Writing a speculative client for a system we have no access to would be
 * inventing a vendor integration.
 *
 * What a real implementation would need:
 *  - LibreView or LibreLinkUp access terms, which differ by region
 *  - the reading cadence, which is not the same as Dexcom's
 *  - whether the account is a patient or a clinical-follower account, since
 *    they carry different data-protection obligations
 *  - the unit convention in the target region: mmol/L in the UK, mg/dL in the US
 */

import type { AdapterHealth, CgmAdapter, GlucoseReading, OAuthToken } from "./types";

export class AbbottLibreAdapter implements CgmAdapter {
  readonly vendor = "abbott" as const;
  readonly isRealTime = false;
  readonly latencySec = 0;
  readonly baseUrl = "not configured — no Abbott client is shipped";

  private readonly reason =
    "Not implemented. Valoris ships no Abbott Libre client. Requires access terms, cadence, account type and regional unit convention from a pilot partner.";

  async connect(_auth: OAuthToken): Promise<void> {
    throw new Error(`Abbott Libre adapter: ${this.reason}`);
  }

  health(): AdapterHealth {
    return {
      available: false,
      unavailableReason: this.reason,
      lastSuccessfulPollMs: null,
      consecutiveFailures: 0,
    };
  }

  async getReadings(_from: Date, _to: Date): Promise<GlucoseReading[]> {
    throw new Error(`Abbott Libre adapter: ${this.reason}`);
  }
}
