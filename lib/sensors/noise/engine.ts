/**
 * Sensor misbehaviour — making a synthetic feed fail like real hardware.
 *
 * WHAT THIS IS NOT: Tier B.
 *
 * Tier B means signal texture derived from REAL wearable recordings of real
 * human subjects — WESAD, PAMAP2, PhysioNet. Those datasets have not been
 * downloaded and their citations have not been obtained, so nothing here is
 * derived from a real recording and nothing here may be labelled Tier B. Every
 * coefficient below is invented. This is Tier C output with Tier C texture, and
 * calling it anything else would be inventing a data provenance, which is the
 * one thing the tier system exists to prevent.
 *
 * WHAT IT IS FOR: a clean synthetic feed never exercises the machinery that
 * matters. Dropout projection, staleness, confidence degradation and the
 * never-SAFE rules all only engage when sensors behave badly, and until now
 * sensors only behaved badly when someone clicked a button. This makes them fail
 * on their own, in the ways real ones do.
 *
 * The failure modes modelled are chosen from how monitoring hardware actually
 * fails, not from what is easy to generate:
 *
 *   FLATLINE   the device keeps transmitting its last reading. The value looks
 *              perfectly plausible; only the timestamp stops moving. This is the
 *              most dangerous failure because it is invisible to anything that
 *              checks for nulls, and it is the one that defeated the first
 *              version of the projection feed.
 *   DROPOUT    the channel reports nothing at all.
 *   SPIKE      a single implausible reading, then normal service.
 *   ARTEFACT   a burst of noise from movement or poor contact.
 *   WANDER     slow baseline drift, the kind a slipping chest strap produces.
 *
 * DETERMINISTIC. No Math.random anywhere: the generator is seeded from the
 * firefighter, the channel and the tick, so the same incident replays
 * identically. A simulator whose failures cannot be reproduced is useless for
 * debugging the thing it is meant to be testing.
 *
 * SIMULATION MODE — NOT FOR OPERATIONAL USE.
 */

export type ArtefactKind = "flatline" | "dropout" | "spike" | "artefact" | "wander";

export type NoiseProfileName = "clean" | "typical" | "degraded";

export type ChannelReading = {
  /** Null means the channel reported nothing this tick. */
  value: number | null;
  /**
   * When this reading was actually taken. A flatlining device keeps sending,
   * so the value stays and THIS stops advancing.
   */
  measuredAtMs: number;
  /** What was done to it, if anything. For the operator, not for the engine. */
  artefact: ArtefactKind | null;
};

export type NoiseContext = {
  callsign: string;
  channel: string;
  tick: number;
  nowMs: number;
};

/**
 * The seam a real Tier B model would implement.
 *
 * When WESAD/PAMAP2 are obtained, the implementation changes and nothing else
 * does — same shape, real texture, and the provenance tier moves from C to B at
 * that point and not before.
 */
export interface SensorNoiseModel {
  readonly name: string;
  readonly dataTier: "B_REAL_WEARABLE_NON_FIREFIGHTER" | "C_SYNTHETIC_MODEL_DRIVEN";
  /** The sentence that must appear wherever this model's output is shown. */
  readonly disclosure: string;
  apply(clean: number, context: NoiseContext): ChannelReading;
}

/* -------------------------------------------------------------------------- */
/* Deterministic pseudo-randomness                                             */
/* -------------------------------------------------------------------------- */

/** FNV-1a over the context, so the same tick always yields the same draw. */
function seedOf(context: NoiseContext): number {
  const key = `${context.callsign}|${context.channel}|${context.tick}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i += 1) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

/** mulberry32. Cheap, deterministic, adequate for shaping a demo feed. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* -------------------------------------------------------------------------- */
/* Profiles                                                                    */
/* -------------------------------------------------------------------------- */

type Rates = {
  /** Chance per tick of a NEW flatline beginning. */
  flatlineStart: number;
  /** Chance per tick that an ongoing flatline ends. */
  flatlineEnd: number;
  dropout: number;
  spike: number;
  artefact: number;
  /** Amplitude of slow baseline drift, in channel units. */
  wanderAmplitude: number;
};

/**
 * Invented rates. Not measured, not fitted, not reviewed.
 *
 * `typical` is tuned so that over a twenty-minute incident most channels behave
 * and at least one firefighter loses something — enough to exercise the
 * machinery without making the demo look broken.
 */
const PROFILES: Record<NoiseProfileName, Rates> = {
  clean: {
    flatlineStart: 0,
    flatlineEnd: 1,
    dropout: 0,
    spike: 0,
    artefact: 0,
    wanderAmplitude: 0,
  },
  typical: {
    flatlineStart: 0.004,
    flatlineEnd: 0.08,
    dropout: 0.006,
    spike: 0.003,
    artefact: 0.02,
    wanderAmplitude: 0.6,
  },
  degraded: {
    flatlineStart: 0.02,
    flatlineEnd: 0.05,
    dropout: 0.04,
    spike: 0.015,
    artefact: 0.08,
    wanderAmplitude: 2.0,
  },
};

/**
 * Synthetic sensor artefacts. Tier C, and says so.
 *
 * Flatline state is carried by the caller rather than held here, so the model
 * stays a pure function and an incident can be replayed from any point.
 */
export class SyntheticArtefactModel implements SensorNoiseModel {
  readonly name: string;
  readonly dataTier = "C_SYNTHETIC_MODEL_DRIVEN" as const;
  readonly disclosure =
    "Synthetic sensor artefacts. NOT derived from real wearable recordings — every coefficient is invented, and nothing here claims Tier B texture.";

  private readonly rates: Rates;
  /** Channel key -> the reading and time it froze at. */
  private readonly frozen = new Map<string, { value: number; atMs: number }>();

  constructor(profile: NoiseProfileName = "typical") {
    this.name = `synthetic_artefacts_${profile}`;
    this.rates = PROFILES[profile];
  }

  apply(clean: number, context: NoiseContext): ChannelReading {
    const key = `${context.callsign}|${context.channel}`;
    const draw = rng(seedOf(context));

    // An ongoing flatline continues until it happens to end. The device is
    // still transmitting, so the VALUE is present and convincing; only the
    // timestamp betrays it.
    const stuck = this.frozen.get(key);
    if (stuck !== undefined) {
      if (draw() < this.rates.flatlineEnd) {
        this.frozen.delete(key);
      } else {
        return { value: stuck.value, measuredAtMs: stuck.atMs, artefact: "flatline" };
      }
    }

    if (draw() < this.rates.flatlineStart) {
      this.frozen.set(key, { value: clean, atMs: context.nowMs });
      return { value: clean, measuredAtMs: context.nowMs, artefact: "flatline" };
    }

    if (draw() < this.rates.dropout) {
      return { value: null, measuredAtMs: context.nowMs, artefact: "dropout" };
    }

    if (draw() < this.rates.spike) {
      // A single implausible reading. Real monitors do this on contact loss.
      const magnitude = 1 + draw() * 0.8;
      const sign = draw() < 0.5 ? -1 : 1;
      return {
        value: Math.round(clean * (1 + sign * magnitude) * 10) / 10,
        measuredAtMs: context.nowMs,
        artefact: "spike",
      };
    }

    if (draw() < this.rates.artefact) {
      const burst = (draw() - 0.5) * 2 * Math.max(2, Math.abs(clean) * 0.08);
      return {
        value: Math.round((clean + burst) * 10) / 10,
        measuredAtMs: context.nowMs,
        artefact: "artefact",
      };
    }

    if (this.rates.wanderAmplitude > 0) {
      // Slow drift, keyed on the tick so it moves smoothly rather than jumping.
      const phase = (context.tick % 240) / 240;
      const drift = Math.sin(phase * Math.PI * 2) * this.rates.wanderAmplitude;
      return {
        value: Math.round((clean + drift) * 10) / 10,
        measuredAtMs: context.nowMs,
        artefact: "wander",
      };
    }

    return { value: clean, measuredAtMs: context.nowMs, artefact: null };
  }

  /** Channels currently flatlining, for the operator's benefit. */
  stuckChannels(): string[] {
    return [...this.frozen.keys()];
  }
}

/**
 * The Tier B slot, deliberately unimplemented.
 *
 * It refuses rather than falling back to synthetic texture, for the same reason
 * `FarsiteAdapter` refuses rather than shipping a speculative client: a stub
 * that quietly degrades to something else teaches callers that the real thing is
 * present when it is not.
 */
export class TierBWearableNoiseModel implements SensorNoiseModel {
  readonly name = "tier_b_wearable_texture";
  readonly dataTier = "B_REAL_WEARABLE_NON_FIREFIGHTER" as const;
  readonly disclosure =
    "Signal texture derived from REAL wearable recordings of NON-FIREFIGHTER subjects. It does not validate any firefighter threshold.";

  apply(): never {
    throw new Error(
      "Tier B noise model is not implemented. WESAD/PAMAP2 have not been " +
        "downloaded and their citations have not been obtained, so no real " +
        "wearable texture exists to apply. Use SyntheticArtefactModel, which is " +
        "Tier C and says so. See docs/DATA_PROVENANCE.md section 2.",
    );
  }
}
