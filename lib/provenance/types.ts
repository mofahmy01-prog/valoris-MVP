/**
 * Data provenance — Tier A / B / C labelling.
 *
 * From the Data Addendum: "Never blur these. Every observation carries a
 * `dataTier` field and the UI shows it."
 *
 * The three tiers describe how real a value is:
 *
 *   A — real environmental measurement (NIFC, Open-Meteo, PurpleAir, FIRMS,
 *       AirNow). Actually measured, in the real world, by someone else.
 *   B — real human wearable data from NON-FIREFIGHTERS (WESAD, PAMAP2,
 *       PhysioNet). Real signal texture, but not firefighter data and never to
 *       be presented as validating firefighter thresholds.
 *   C — synthetic, model-driven output (ISO 7933 PHS, Karvonen, the Valoris
 *       physiology models). No measurement of any kind.
 *
 * An observation is NOT a single tier. It mixes real environmental readings with
 * synthetic physiology, so a single `dataTier` on the row would blur exactly
 * what the addendum forbids. Provenance is therefore recorded **per domain**,
 * and the row-level summary lists every tier present rather than collapsing them
 * to one.
 *
 * No imports. Pure types and pure functions.
 */

export type DataTier =
  | "A_REAL_ENVIRONMENTAL"
  | "B_REAL_WEARABLE_NON_FIREFIGHTER"
  | "C_SYNTHETIC_MODEL_DRIVEN";

export const DATA_TIERS: readonly DataTier[] = [
  "A_REAL_ENVIRONMENTAL",
  "B_REAL_WEARABLE_NON_FIREFIGHTER",
  "C_SYNTHETIC_MODEL_DRIVEN",
];

/** Exactly the shape the addendum specifies. */
export type Provenance = {
  dataTier: DataTier;
  source: string;
  retrievedAt?: string;
  licence?: string;
  modelRef?: string;
  isSimulated: boolean;
};

/** The domains an observation spans. Each carries its own provenance. */
export type ProvenanceDomain =
  | "environment"
  | "vitals"
  | "position"
  | "derivedPhysiology"
  | "fireFront";

export const PROVENANCE_DOMAINS: readonly ProvenanceDomain[] = [
  "environment",
  "vitals",
  "position",
  "derivedPhysiology",
  "fireFront",
];

export type ObservationProvenance = Record<ProvenanceDomain, Provenance>;

/* -------------------------------------------------------------------------- */
/* Display                                                                     */
/* -------------------------------------------------------------------------- */

export const TIER_LABEL: Record<DataTier, string> = {
  A_REAL_ENVIRONMENTAL: "Tier A — REAL environmental measurement",
  B_REAL_WEARABLE_NON_FIREFIGHTER:
    "Tier B — REAL wearable data from non-firefighter subjects",
  C_SYNTHETIC_MODEL_DRIVEN: "Tier C — SIMULATED, model-driven",
};

/** Short badge for dense UI. Never just a colour — always the letter too. */
export const TIER_BADGE: Record<DataTier, string> = {
  A_REAL_ENVIRONMENTAL: "A · REAL",
  B_REAL_WEARABLE_NON_FIREFIGHTER: "B · REAL (not firefighter)",
  C_SYNTHETIC_MODEL_DRIVEN: "C · SIMULATED",
};

/**
 * The mandatory honesty sentence for each tier. Anywhere Tier B appears, the
 * addendum requires the non-firefighter statement verbatim.
 */
export const TIER_DISCLOSURE: Record<DataTier, string> = {
  A_REAL_ENVIRONMENTAL:
    "Real measured environmental data from an external source. Crew positions and physiology are not real.",
  B_REAL_WEARABLE_NON_FIREFIGHTER:
    "Signal characteristics derived from WESAD/PAMAP2 (non-firefighter human subjects). Not firefighter physiological data.",
  C_SYNTHETIC_MODEL_DRIVEN:
    "Synthetic output of a deterministic physiological model. Not measured. Not clinically validated.",
};

/* -------------------------------------------------------------------------- */
/* Known provenance records                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Every provenance record the build currently uses. Declaring them here rather
 * than inline stops a caller inventing a source string, and makes the full set
 * auditable in one place.
 *
 * Anything absent from this list does not exist yet. In particular there is no
 * Tier B entry in use: no noise model has been built, so nothing may claim
 * Tier B.
 */
export const PROVENANCE: {
  simulatedEnvironment: Provenance;
  simulatedVitals: Provenance;
  simulatedPosition: Provenance;
  derivedPhysiology: Provenance;
  purpleAirEnvironment: Provenance;
  geometricFireFront: Provenance;
  observedPerimeter: Provenance;
  unavailableFireFront: Provenance;
  commanderEntered: Provenance;
} = {
  simulatedEnvironment: {
    dataTier: "C_SYNTHETIC_MODEL_DRIVEN",
    source: "valoris_simulated_atmosphere",
    isSimulated: true,
    modelRef: "No environmental fixture loaded; values supplied by the caller.",
  },
  simulatedVitals: {
    dataTier: "C_SYNTHETIC_MODEL_DRIVEN",
    source: "valoris_simulated_wearable",
    isSimulated: true,
    modelRef:
      "Synthetic sensor stream. No Tier B noise model applied — none has been built.",
  },
  simulatedPosition: {
    dataTier: "C_SYNTHETIC_MODEL_DRIVEN",
    source: "valoris_simulated_deployment_position",
    isSimulated: true,
    modelRef:
      "Simulated deployment position. Real crew positions are never invented.",
  },
  derivedPhysiology: {
    dataTier: "C_SYNTHETIC_MODEL_DRIVEN",
    source: "valoris_physiology_models",
    isSimulated: true,
    modelRef:
      "Reduced ISO 7933 PHS heat balance, Karvonen heart-rate reserve with PPE penalty, blended core temperature estimate, fatigue and toxic exposure accumulators. See docs/CLINICAL_ASSUMPTIONS.md.",
  },
  purpleAirEnvironment: {
    dataTier: "A_REAL_ENVIRONMENTAL",
    source: "purpleair_sensor_network",
    licence:
      "PurpleAir data requires attribution. The attribution must appear in the report footer.",
    isSimulated: false,
    modelRef:
      "PM2.5 corrected using the EPA US-wide equation extended for wildfire smoke (Barkjohn et al. 2022). Known limitation: approximately 12% underestimate at smoke concentrations. Raw sensor values retained. Correction coefficients UNVERIFIED — see docs/DATA_PROVENANCE.md blocking item 2.",
  },
  geometricFireFront: {
    dataTier: "C_SYNTHETIC_MODEL_DRIVEN",
    source: "valoris_geometric_spread_placeholder",
    isSimulated: true,
    modelRef:
      "Wind-driven ellipse drawn by Valoris. Not a fire behaviour prediction.",
  },
  observedPerimeter: {
    dataTier: "A_REAL_ENVIRONMENTAL",
    source: "operator_supplied_perimeter_geojson",
    licence: "Per the supplying dataset — NIFC Open Data is public domain",
    isSimulated: false,
    modelRef: "Observed perimeter geometry. Not extrapolated into the future.",
  },
  unavailableFireFront: {
    dataTier: "C_SYNTHETIC_MODEL_DRIVEN",
    source: "none",
    isSimulated: true,
    modelRef: "No fire front available; distance to front is absent.",
  },
  commanderEntered: {
    dataTier: "C_SYNTHETIC_MODEL_DRIVEN",
    source: "commander_manual_entry",
    isSimulated: true,
    modelRef: "Entered by hand during a simulation exercise.",
  },
};

/* -------------------------------------------------------------------------- */
/* Aggregation                                                                 */
/* -------------------------------------------------------------------------- */

/** Every distinct tier present, in A, B, C order. Never collapsed to one. */
export function tiersPresent(provenance: ObservationProvenance): DataTier[] {
  const present = new Set<DataTier>();
  for (const domain of PROVENANCE_DOMAINS) {
    present.add(provenance[domain].dataTier);
  }
  return DATA_TIERS.filter((tier) => present.has(tier));
}

/**
 * Compact summary, e.g. "A+C". Deliberately not a single tier: an observation
 * that mixes a real perimeter with synthetic physiology is both, and saying so
 * is the point.
 */
export function tierSummary(provenance: ObservationProvenance): string {
  const letters = tiersPresent(provenance).map((tier) => tier.charAt(0));
  return letters.length === 0 ? "unknown" : letters.join("+");
}

/** True when every domain is synthetic — nothing real is involved. */
export function isFullySimulated(provenance: ObservationProvenance): boolean {
  return PROVENANCE_DOMAINS.every((domain) => provenance[domain].isSimulated);
}

export type ProvenanceStripLine = {
  domain: string;
  tier: DataTier;
  badge: string;
  verdict: "REAL" | "SIMULATED";
  source: string;
  disclosure: string;
};

/**
 * The commander dashboard's data provenance strip, as specified in the addendum.
 * Returns structured lines so the UI cannot paraphrase them into something
 * softer than the truth.
 */
export function provenanceStrip(
  provenance: ObservationProvenance,
): ProvenanceStripLine[] {
  const label: Record<ProvenanceDomain, string> = {
    environment: "Environment",
    fireFront: "Fire front",
    position: "Crew positions",
    vitals: "Crew vitals",
    derivedPhysiology: "Physiology",
  };
  const order: ProvenanceDomain[] = [
    "environment",
    "fireFront",
    "position",
    "vitals",
    "derivedPhysiology",
  ];
  return order.map((domain) => {
    const p = provenance[domain];
    return {
      domain: label[domain],
      tier: p.dataTier,
      badge: TIER_BADGE[p.dataTier],
      verdict: p.isSimulated ? "SIMULATED" : "REAL",
      source: p.source,
      disclosure: TIER_DISCLOSURE[p.dataTier],
    };
  });
}

/* -------------------------------------------------------------------------- */
/* Validation                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * A Tier A record must not claim to be simulated, and a Tier C record must not
 * claim to be real. This catches the single most damaging mislabelling — a
 * synthetic value presented as a measurement — at the point of construction.
 */
export function assertProvenanceCoherent(p: Provenance, context: string): void {
  if (p.dataTier === "A_REAL_ENVIRONMENTAL" && p.isSimulated) {
    throw new Error(
      `${context}: Tier A is real measured data and cannot be marked isSimulated`,
    );
  }
  if (p.dataTier === "C_SYNTHETIC_MODEL_DRIVEN" && !p.isSimulated) {
    throw new Error(
      `${context}: Tier C is synthetic model output and must be marked isSimulated`,
    );
  }
  if (p.dataTier === "B_REAL_WEARABLE_NON_FIREFIGHTER" && p.isSimulated) {
    throw new Error(
      `${context}: Tier B is real recorded human data and cannot be marked isSimulated`,
    );
  }
  if (p.source.trim() === "") {
    throw new Error(`${context}: provenance must name a source`);
  }
}

export function assertObservationProvenanceCoherent(
  provenance: ObservationProvenance,
  context: string,
): void {
  for (const domain of PROVENANCE_DOMAINS) {
    assertProvenanceCoherent(provenance[domain], `${context}.${domain}`);
  }
}
