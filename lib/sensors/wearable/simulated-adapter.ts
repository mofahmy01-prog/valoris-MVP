/**
 * Simulated wearable adapter — Tier C, and says so.
 *
 * Wraps the existing synthetic feed in the vendor-agnostic interface so the
 * seam is exercised by something real rather than only by stubs. When a genuine
 * monitor arrives, it implements the same interface and nothing downstream
 * changes.
 *
 * It deliberately behaves like awkward hardware in two ways that adapters
 * usually paper over:
 *
 *   - it reports MEASUREMENT time separately from receipt time, because
 *     conflating them silently corrupts every staleness and projection
 *     calculation in the system;
 *   - it reports battery, because a monitor at 3% is an operational fact a
 *     commander needs before the readings stop.
 *
 * SIMULATION MODE — NOT FOR OPERATIONAL USE.
 */

import { SyntheticArtefactModel, type NoiseProfileName } from "@/lib/sensors/noise/engine";

import {
  WEARABLE_CHANNELS,
  type WearableAdapter,
  type WearableAdapterHealth,
  type WearableChannel,
  type WearableReading,
  type WearableSample,
} from "./types";

export type SimulatedSubject = {
  deviceId: string;
  callsign: string;
  /** Clean values the device would report, before artefacts. */
  clean: Partial<Record<WearableChannel, number>>;
  batteryPct: number | null;
};

export class SimulatedWearableAdapter implements WearableAdapter {
  readonly vendor = "simulated";
  readonly dataTier = "C_SYNTHETIC_MODEL_DRIVEN" as const;
  readonly disclosure =
    "Simulated wearable output. No real device, no real subject. Tier C — this is not Tier B, which means real recordings of real (non-firefighter) people.";
  readonly isRealDevice = false;
  readonly latencySec = 0;

  private readonly noise: SyntheticArtefactModel;
  private readonly subjects: SimulatedSubject[];
  private tick = 0;
  private lastSuccessfulPollMs: number | null = null;

  constructor(subjects: SimulatedSubject[], profile: NoiseProfileName = "typical") {
    this.subjects = subjects;
    this.noise = new SyntheticArtefactModel(profile);
  }

  resolveCallsign(deviceId: string): string | null {
    return this.subjects.find((s) => s.deviceId === deviceId)?.callsign ?? null;
  }

  async poll(_from: Date, to: Date): Promise<WearableSample[]> {
    this.tick += 1;
    const nowMs = to.getTime();

    const samples = this.subjects.map((subject) => {
      const readings: WearableReading[] = [];

      for (const channel of WEARABLE_CHANNELS) {
        const clean = subject.clean[channel];
        if (clean === undefined) continue;

        const reading = this.noise.apply(clean, {
          callsign: subject.callsign,
          channel,
          tick: this.tick,
          nowMs,
        });

        readings.push({
          channel,
          value: reading.value,
          // The device's own measurement time. A flatlining monitor keeps
          // sending, so this is what stops advancing, not the value.
          measuredAtUtc: new Date(reading.measuredAtMs),
          measuredAtIsReceiptTime: false,
          vendorQuality: reading.artefact === null ? null : `artefact:${reading.artefact}`,
        });
      }

      return {
        deviceId: subject.deviceId,
        readings,
        batteryPct: subject.batteryPct,
      };
    });

    this.lastSuccessfulPollMs = nowMs;
    return samples;
  }

  health(): WearableAdapterHealth {
    return {
      available: true,
      unavailableReason: null,
      lastSuccessfulPollMs: this.lastSuccessfulPollMs,
      consecutiveFailures: 0,
    };
  }
}
