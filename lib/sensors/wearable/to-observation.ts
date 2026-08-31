/**
 * Turning wearable readings into observations.
 *
 * The missing link between the adapter seam and the ingestion path. Without it
 * the seam was a shape nothing flowed through, and "attach a real monitor" had
 * no meaning beyond implementing an interface.
 *
 * THE ONE RULE: this translates, it does not improve.
 *
 * No gap filling, no smoothing, no unit guessing, no substituting a plausible
 * value for a missing one. Every one of those would be a physiological model
 * wearing an adapter's clothes, and the engine already has machinery for absent
 * data that is better than anything invented here. A channel the device did not
 * report arrives as absent, and the staleness and projection rules take it from
 * there.
 *
 * SIMULATION MODE — NOT FOR OPERATIONAL USE.
 */

import type { WearableChannel, WearableSample } from "./types";

/** The observation payload shape, as `POST /observations` validates it. */
type Channel = { value: number; updatedAtUtc: string };

export type ObservationVitals = {
  hrBpm?: Channel;
  spo2Pct?: Channel;
  respRatePerMin?: Channel;
  coreTempC?: Channel;
  fallDetected: boolean;
};

export type TranslatedObservation = {
  callsign: string;
  vitals: ObservationVitals;
  /** Channels the device reported as absent this poll. For the operator. */
  absentChannels: WearableChannel[];
  /**
   * True when ANY reading in this sample carried receipt time instead of
   * measurement time. Every staleness figure downstream inherits the transport
   * latency as error, and that has to travel with the data rather than be
   * silently absorbed.
   */
  agesAreApproximate: boolean;
  batteryPct: number | null;
};

/**
 * Channels the observation schema accepts, and where they land.
 *
 * `skinTempC` and `movementIndex` are deliberately dropped: the engine has no
 * threshold for either, and inventing a mapping — skin temperature standing in
 * for core, say — would be exactly the kind of unvalidated physiological
 * inference this module refuses to make. Dropping them is recorded rather than
 * silent.
 */
const ACCEPTED: Partial<Record<WearableChannel, keyof ObservationVitals>> = {
  hrBpm: "hrBpm",
  spo2Pct: "spo2Pct",
  respRatePerMin: "respRatePerMin",
  coreTempC: "coreTempC",
};

export const DROPPED_CHANNELS: WearableChannel[] = ["skinTempC", "movementIndex"];

export function toObservation(
  sample: WearableSample,
  callsign: string,
): TranslatedObservation {
  const vitals: ObservationVitals = { fallDetected: false };
  const absentChannels: WearableChannel[] = [];
  let agesAreApproximate = false;

  for (const reading of sample.readings) {
    const field = ACCEPTED[reading.channel];
    if (field === undefined) continue;

    if (reading.measuredAtIsReceiptTime) agesAreApproximate = true;

    if (reading.value === null) {
      // Absent stays absent. The engine's staleness and projection rules handle
      // a gap better than any value this module could invent.
      absentChannels.push(reading.channel);
      continue;
    }

    if (field === "fallDetected") continue;
    vitals[field] = {
      value: reading.value,
      // The DEVICE's measurement time, never the moment we received it.
      updatedAtUtc: reading.measuredAtUtc.toISOString(),
    };
  }

  return {
    callsign,
    vitals,
    absentChannels,
    agesAreApproximate,
    batteryPct: sample.batteryPct,
  };
}

/** Translate a whole poll, dropping samples whose device maps to nobody. */
export function toObservations(
  samples: WearableSample[],
  resolveCallsign: (deviceId: string) => string | null,
): { translated: TranslatedObservation[]; unmappedDevices: string[] } {
  const translated: TranslatedObservation[] = [];
  const unmappedDevices: string[] = [];

  for (const sample of samples) {
    const callsign = resolveCallsign(sample.deviceId);
    if (callsign === null) {
      // Never guess. A reading attributed to the wrong firefighter is worse
      // than a reading discarded, because it looks like knowledge about them.
      unmappedDevices.push(sample.deviceId);
      continue;
    }
    translated.push(toObservation(sample, callsign));
  }

  return { translated, unmappedDevices };
}
