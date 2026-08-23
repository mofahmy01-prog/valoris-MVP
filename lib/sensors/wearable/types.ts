/**
 * Wearable adapter — the vendor-agnostic seam for physiological monitoring.
 *
 * WHY THIS EXISTS. Everything upstream of the risk engine is currently
 * synthetic, and the day a real physiological status monitor arrives, the
 * question is whether integrating it is one file or a rewrite. This interface
 * makes it one file, the same way `CgmAdapter` did for glucose.
 *
 * The engine must never learn which vendor is attached. It receives normalised
 * channel readings with timestamps and a data tier, and nothing else — no vendor
 * name, no device model, no transport. A test enforces that boundary for the
 * fire providers already; the same discipline applies here.
 *
 * WHAT IS DELIBERATELY ABSENT: any real vendor client. Valoris ships no Zephyr,
 * no Equivital, no Hexoskin, no MSA integration, and invents no endpoints or
 * credentials for them. Writing a speculative client for hardware we have no
 * access to would be inventing a vendor integration, which is the same failure
 * as inventing a data provenance.
 *
 * SIMULATION MODE — NOT FOR OPERATIONAL USE.
 */

import type { DataTier } from "@/lib/provenance/types";

/** Channels a physiological monitor can report. Deliberately a closed set. */
export const WEARABLE_CHANNELS = [
  "hrBpm",
  "spo2Pct",
  "respRatePerMin",
  "coreTempC",
  "skinTempC",
  "movementIndex",
] as const;
export type WearableChannel = (typeof WEARABLE_CHANNELS)[number];

/**
 * One normalised reading.
 *
 * `measuredAtUtc` is the moment the DEVICE took the reading, never the moment
 * Valoris received it. Every staleness rule, the projection horizon and the
 * confidence machinery all key off that distinction, and a vendor that only
 * reports receipt time must say so rather than have the adapter guess.
 */
export type WearableReading = {
  channel: WearableChannel;
  value: number | null;
  measuredAtUtc: Date;
  /**
   * True when the adapter had to substitute receipt time because the vendor
   * does not report a measurement time. Ages computed from it are wrong by the
   * transport latency, and the picture must say so rather than absorb it.
   */
  measuredAtIsReceiptTime: boolean;
  /** Vendor-reported quality, where one exists. Never invented. */
  vendorQuality: string | null;
};

export type WearableSample = {
  /** Which firefighter this belongs to, as the vendor identifies them. */
  deviceId: string;
  readings: WearableReading[];
  /** Battery percent, where reported. A flat monitor is an operational fact. */
  batteryPct: number | null;
};

export type WearableAdapterHealth = {
  available: boolean;
  unavailableReason: string | null;
  lastSuccessfulPollMs: number | null;
  consecutiveFailures: number;
};

export interface WearableAdapter {
  readonly vendor: string;
  /**
   * What tier this adapter's output carries.
   *
   * A simulated adapter is Tier C. A real device on a real firefighter would be
   * a tier this project does not currently have a name for, because Tier B is
   * explicitly non-firefighter subjects — that gap is recorded rather than
   * papered over by reusing B.
   */
  readonly dataTier: DataTier;
  /** The sentence that must appear wherever this adapter's data is shown. */
  readonly disclosure: string;
  /** False for every adapter in this build. */
  readonly isRealDevice: boolean;
  /** Expected transport latency in seconds, where known. */
  readonly latencySec: number;

  /** Map a vendor device id onto a Valoris callsign. */
  resolveCallsign(deviceId: string): string | null;

  poll(from: Date, to: Date): Promise<WearableSample[]>;
  health(): WearableAdapterHealth;
}
