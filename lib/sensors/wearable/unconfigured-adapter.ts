/**
 * A real vendor's adapter — INTERFACE STUB. DELIBERATELY UNIMPLEMENTED.
 *
 * Named generically on purpose. Naming a specific manufacturer here would imply
 * a relationship that does not exist, and Valoris does not claim vendor
 * integrations it has not got — the same rule that keeps `FarsiteAdapter` and
 * `AbbottLibreAdapter` as refusing stubs.
 *
 * It REFUSES rather than falling back to the simulated adapter. A stub that
 * quietly degrades teaches callers the real thing is present when it is not,
 * and on a fireground that is the difference between "no data" and "data you
 * believe".
 *
 * What a real implementation needs, none of which can be guessed:
 *  - the vendor's data-sharing terms, and whether they permit occupational use
 *  - the transport: some monitors relay through a gateway, some through a phone,
 *    some only sync on dock
 *  - whether the device reports MEASUREMENT time or only receipt time. If only
 *    receipt time, every staleness and projection figure inherits the transport
 *    latency as error, and `measuredAtIsReceiptTime` must be set true
 *  - the reading cadence, which differs per channel on most devices
 *  - the device's own quality flags, which must be carried through rather than
 *    discarded
 *  - a DPIA and the lawful basis for processing, before a single reading is
 *    taken from a real person
 */

import type {
  WearableAdapter,
  WearableAdapterHealth,
  WearableSample,
} from "./types";

export class UnconfiguredWearableAdapter implements WearableAdapter {
  readonly vendor: string;
  readonly dataTier = "C_SYNTHETIC_MODEL_DRIVEN" as const;
  readonly disclosure =
    "No wearable vendor is integrated. This adapter reports nothing and refuses to be polled.";
  readonly isRealDevice = false;
  readonly latencySec = 0;

  private readonly reason: string;

  constructor(vendor = "unconfigured") {
    this.vendor = vendor;
    this.reason =
      `No client is shipped for "${vendor}". Valoris invents no vendor ` +
      "integrations. Requires data-sharing terms, transport, whether the device " +
      "reports measurement or receipt time, per-channel cadence, quality flags, " +
      "and a DPIA before any reading is taken from a real person.";
  }

  resolveCallsign(): string | null {
    return null;
  }

  async poll(): Promise<WearableSample[]> {
    throw new Error(`Wearable adapter: ${this.reason}`);
  }

  health(): WearableAdapterHealth {
    return {
      available: false,
      unavailableReason: this.reason,
      lastSuccessfulPollMs: null,
      consecutiveFailures: 0,
    };
  }
}
