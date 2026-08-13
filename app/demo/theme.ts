/** Visual spec for the demo. Colour is never the only signal. */

export const COLOURS = {
  background: "#05060F",
  panel: "#0C0F20",
  border: "#1A2040",
  text: "#E8ECF8",
  muted: "#7A82AE",
} as const;

export type Band = "SAFE" | "CAUTION" | "HIGH" | "CRITICAL" | "UNKNOWN";

export const BAND_COLOUR: Record<Band, string> = {
  SAFE: "#00C878",
  CAUTION: "#F0A020",
  HIGH: "#F05A00",
  CRITICAL: "#CC1020",
  UNKNOWN: "#7A82AE",
};

/** A shape or letter alongside every colour, so colour is never load-bearing. */
export const BAND_GLYPH: Record<Band, string> = {
  SAFE: "●",
  CAUTION: "▲",
  HIGH: "◆",
  CRITICAL: "✖",
  UNKNOWN: "?",
};

/** Worst first. */
export const BAND_ORDER: Record<Band, number> = {
  CRITICAL: 0,
  HIGH: 1,
  UNKNOWN: 2,
  CAUTION: 3,
  SAFE: 4,
};

/**
 * Vital channels whose absence means the picture of this person is broken.
 * Mirrors the engine's critical set; glucose is critical only for a CGM wearer,
 * and the engine only ever reports it missing for those firefighters.
 */
const CRITICAL_CHANNELS = ["hrBpm", "spo2Pct", "coreTempC", "glucoseMmolL"];

/**
 * True when a critical input is absent.
 *
 * The engine reports the MORE SEVERE of the composite band and UNKNOWN, so a
 * firefighter with a dead heart-rate monitor next to an advancing fire still
 * reads CAUTION or HIGH — deliberately, so a dropped sensor cannot hide real
 * danger. That is correct, but it means the band alone does not tell a commander
 * the sensor is gone. The UI therefore treats missing critical data as its own
 * visual state, on top of the band.
 */
export function isDataLost(missingInputs: string[] | undefined): boolean {
  if (missingInputs === undefined) return false;
  return missingInputs.some((m) => CRITICAL_CHANNELS.includes(m));
}

export type Presentation = {
  colour: string;
  glyph: string;
  label: string;
  /** Render the grey dashed "we cannot see this person" treatment. */
  greyed: boolean;
  /** Extra badge shown when danger and data loss coincide. */
  badge: string | null;
};

/**
 * How a card or marker should look.
 *
 * SEVERITY WINS. If the remaining evidence says HIGH or CRITICAL, that is shown
 * in full colour with a separate data-missing badge — greying out a genuinely
 * critical firefighter would hide a real danger behind a sensor message, which
 * is the exact inverse of the failure the grey state exists to prevent.
 *
 * Grey with `?` is used only when there is no competing danger signal: the
 * score is untrustworthy and nothing else is shouting.
 */
export function presentation(
  band: Band,
  missingInputs: string[] | undefined,
): Presentation {
  const lost = isDataLost(missingInputs);
  const severe = BAND_ORDER[band] <= BAND_ORDER.HIGH;

  if (lost && severe) {
    return {
      colour: BAND_COLOUR[band],
      glyph: BAND_GLYPH[band],
      label: band,
      greyed: false,
      badge: "? DATA MISSING",
    };
  }
  if (lost) {
    return {
      colour: BAND_COLOUR.UNKNOWN,
      glyph: "?",
      label: "SENSOR LOST",
      greyed: true,
      badge: null,
    };
  }
  return {
    colour: BAND_COLOUR[band],
    glyph: BAND_GLYPH[band],
    label: band,
    greyed: band === "UNKNOWN",
    badge: null,
  };
}

export function asBand(value: unknown): Band {
  const b = String(value);
  return b === "SAFE" || b === "CAUTION" || b === "HIGH" || b === "CRITICAL"
    ? b
    : "UNKNOWN";
}
