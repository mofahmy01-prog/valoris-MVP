# Clinical assumptions

**SIMULATION MODE — NOT FOR OPERATIONAL USE.**

Valoris is a research prototype. It is not a medical device, it is not clinically
validated, and nothing in this document has been reviewed by a clinician.

Every threshold in `config/risk-default.json` ships as:

- `sourceStatus: "illustrative"`
- `clinicalReviewStatus: "unreviewed"`

Nothing may be promoted to `validated` or `approved_for_pilot` without a named
occupational physician signing the checklist at the end of this document.

## What external guidance does and does not do here

External material — for example American Diabetes Association or British
Thoracic Society publications — may inform the choice of an **individual
threshold**. It does **not** validate Valoris. No external body has reviewed,
endorsed or validated this model, its weighting, its bands, or its outputs.
Any claim to the contrary would be false.

## Assumptions that need clinical review

### 1. Estimated core temperature is not measured core temperature

`coreTempC` is an **estimate**. The prototype treats it as a directly usable
number. In reality, wearable core-temperature estimation carries error that
varies with hydration, clothing, workload and skin perfusion. Every surface that
displays it must say "estimated".

**Needs review:** whether an estimated value should drive a hard override at all,
and if so with what margin.

### 2. Age-adjusted maximum heart rate uses `220 − age`

`hr_max_age_constant_bpm = 220`. This is a crude population formula with a
standard deviation of roughly ±10–12 bpm at the individual level. It is used
because it is transparent and needs no measurement. It is not an individual
maximum.

**Needs review:** whether to require a measured or estimated individual maximum
before this drives a hard override at 97%.

`restingHrBpm` is captured on the profile but is **not** currently used in
scoring. A heart-rate-reserve (Karvonen) formulation would use it and would
personalise further. That change is deliberately not made without review.

### 3. SpO2 is scored as deviation from a personal baseline

Absolute SpO2 cut-offs punish people whose normal sits lower. Valoris scores the
gap between the current reading and `spo2BaselinePct`, and separately applies an
absolute hard-override floor.

**Needs review:** the baseline capture method, how often it is refreshed, and
whether pulse oximetry accuracy at low saturation and across skin tones makes the
88–91% region safe to act on. Pulse oximeter bias in darker skin tones is a known
and documented safety issue; this prototype does not correct for it.

### 4. Respiratory risk shifts SpO2 alerting earlier

`resp_risk_spo2_alert_shift_pct_per_level = 1` percentage point per level
(mild 1, moderate 2, high 3). A firefighter with moderate asthma therefore hits
the SpO2 hard override at 90% rather than 88%, and their deviation ramp tightens
by the same amount.

**Needs review:** the direction is defensible; the magnitude is invented.

### 5. Heat tolerance shifts temperature limits

`heat_tolerance_core_temp_shift_c = 0.5` and
`heat_tolerance_ambient_shift_c = 2`. Low tolerance tightens limits, high
tolerance relaxes them.

**Needs review:** relaxing a limit for "high heat tolerance" allows a hotter
person to be scored lower. That is the intended personalisation, and it is also
the most dangerous direction of travel in the whole model. A physician should
decide whether limits may ever be relaxed above the population value, or whether
high tolerance should only reduce the *rate* of escalation.

### 6. Previous shift hours raise the fatigue baseline

`prev_shift_fatigue_pct_per_hour = 1.5`. An 11-hour previous shift adds 16.5
points to the fatigue index before any current-incident fatigue is counted. The
same hours are *also* scored in the profile subscore, so they are counted twice
by design.

**Needs review:** whether double counting is appropriate, and whether recovery
time since the shift should attenuate it. Recovery time is not currently modelled.

### 7. Condition count is a poor proxy for clinical severity

`condition_score_per_condition = 25`, capped at 100. Four mild conditions score
the same as one severe one. This is known to be wrong and is retained only
because a severity-weighted model needs clinical input to build.

**Needs review:** replace with a severity-weighted condition model.

### 8. Cumulative exposure indices are unitless placeholders

`cumulativeCoExposureIndex` and `cumulativeHeatExposureIndex` are 0–1 numbers
with no defined derivation, half-life or units. They tighten CO/PM2.5 thresholds
by up to 30% and ambient heat limits by up to 5 °C.

**Needs review:** define what these indices actually measure, over what window,
and with what decay.

### 9. SCBA attenuates but never eliminates inhalation hazard

`scba_inhalation_protection_factor = 0.25`, applied to CO and PM2.5 while on air.
It is deliberately not zero: this system cannot verify mask seal, cylinder
contents or wear compliance.

**Needs review:** the factor is invented.

### 10. Humidity is a crude stand-in for a heat index

Effective ambient temperature adds `humidity_heat_penalty_c_per_10pct = 1 °C` per
10 percentage points of humidity above 50%. This is not WBGT and is not a
validated heat index.

**Needs review:** replace with WBGT or an equivalent recognised index.

### 11. Weights and band cut-offs are unvalidated

Composite weights (40/30/20/10), sub-weights within each subscore, and the band
cut-offs (25/50/75) are all illustrative. No calibration data exists.

**Needs review:** everything.

### 12. The SpO2 override confirmation window

The SpO2 hard override requires `override_spo2_confirm_readings = 3` consecutive
breaching readings, supplied by the caller as `Vitals.recentSpo2Pct`. **If that
history is absent or too short, the engine fails safe and treats a single
breaching reading as actionable.** This is a deliberate choice: it may generate
false alarms, and it will never suppress a real one for want of history.

**Needs review:** whether fail-safe-to-alert is the right default, or whether an
unconfirmable breach should raise a `check_sensor` prompt instead.

### 13. Projected values for dropped sensors (planned, Milestone 5)

When a sensor stops reporting, Valoris will project that channel forward from the
firefighter's own recent measured readings rather than scoring it as worst case.
The governing rule is that **an estimate may only move in the dangerous
direction**: the imputed value is the worse of the last measured value and its
recent measured slope extrapolated forward.

This is a clinical claim, not just an engineering one. It asserts that a
deterioration observed over the preceding window is more likely to continue than
to reverse, over a short horizon, under continuing exertion.

**Needs review:** whether that assumption holds for each channel; the minimum
history depth and maximum projection horizon per channel; and whether a projected
value may fire a hard override at all, or only raise the band short of
`CRITICAL`.

Explicitly **out of scope** and not to be built without separate review:
estimating a missing physiological value from ambient conditions, workload,
proximity or crewmates' readings. That would be an invented physiological model.

### 14. Personalisation is additive, not compounding

**Status: `illustrative` / `unreviewed`. Raised by engineering from observed model
behaviour, not from any clinical source.**

Measured behaviour, from `npm run sweep` (six profiles held fixed, vitals held
fixed, environmental and proximity severity escalated across six steps from
benign to extreme):

| Step | ALPHA-1 (28, high fitness, no conditions) | BRAVO-2 (52, moderate fitness, moderate asthma) | Gap |
|---|---|---|---|
| 1 benign | 14.8 SAFE | 23.6 SAFE | 8.8 |
| 2 light | 14.8 SAFE | 23.6 SAFE | 8.8 |
| 3 moderate | 17.0 SAFE | 27.7 CAUTION | 10.7 |
| 4 heavy | 29.3 CAUTION | 40.2 CAUTION | 10.9 |
| 5 severe | 39.2 CAUTION | 50.3 HIGH | 11.1 |
| 6 extreme | 46.6 CAUTION | 56.7 HIGH | 10.1 |

**Profile-based personalisation currently behaves as a near-constant offset
(8.8–11.1 points) rather than a widening divergence as conditions worsen.
Physiologically, vulnerability may compound under stress rather than remain
parallel — a firefighter with reduced reserve may deteriorate
disproportionately in severe conditions. Question for review: should the profile
subscore scale multiplicatively with environmental and proximity severity rather
than additively? Current behaviour means personalisation only changes a
commander's decision where band cut-offs happen to fall relative to a fixed
offset.**

Why it happens: the composite is a weighted sum of four subscores
(physiological 40%, environmental 30%, proximity 20%, profile 10%). The profile
subscore depends only on the individual and does not vary with conditions, so it
contributes a fixed increment at every severity level. The gap widens slightly
(8.8 → 11.1) only because respiratory risk and cumulative exposure tighten the
*environmental* thresholds, which is a second-order effect.

What this does and does not mean:

- It does **not** mean personalisation is inert. In the sweep the crew occupied
  different bands at 3 of 6 steps, and BRAVO-2 reached `HIGH` at least two steps
  before ALPHA-1 — see docs/KNOWN_LIMITATIONS.md.
- It **does** mean the operational value of personalisation is sensitive to where
  the band cut-offs sit. A fixed ~10-point offset only changes a decision when a
  cut-off falls inside it.

**No multiplicative model has been implemented.** Changing additive to
multiplicative composition would alter every score in the system and is a
clinical decision, not an engineering one. Logged for review only.

**Needs review:** whether profile vulnerability should interact
multiplicatively with environmental and proximity severity; and if so, whether
the interaction should be bounded, since an unbounded product would let profile
alone drive a `CRITICAL` band in severe conditions.

### 15. Two different core temperature limits, neither labelled

**Status: `illustrative` / `unreviewed`. Commander-confusion risk, raised by
engineering.**

There are currently **two** personalised core temperature limits in the system,
for two different purposes, and nothing on screen distinguishes them:

| Parameter | Config | Default | Purpose | Personalisation |
|---|---|---|---|---|
| `phs_core_temp_limit_c` | physiology | 38.0 °C | Exposure-duration ceiling — computes allowable minutes | `heat_tolerance_core_limit_shift_c` = 0.3 °C |
| `override_core_temp_critical_c` | risk | 39.5 °C | Mayday-level hard override — fires `CRITICAL` | `heat_tolerance_core_temp_shift_c` = 0.5 °C |

For BRAVO-2 (low heat tolerance) that produces a displayed "core temperature
limit" of **37.7 °C** from the physiology model, while the `CRITICAL` override
fires at **39.0 °C**. A commander reading 38.4 °C against a stated limit of
37.7 °C would reasonably expect an alert, and would not get one for another
0.6 °C.

Observed live in `npm run verify:m3b`.

**Question for review:** are two limits correct in principle — a "you should
rotate soon" ceiling and a "this is an emergency" threshold — and if so, what
should each be called on a commander's screen? If only one is defensible, which?
Engineering will not pick either the values or the labels.

**Needs review:** whether both limits should exist; what each is named in the UI;
and whether the two personalisation shift parameters (0.3 °C and 0.5 °C) should
be the same number.

### 16. Modelled core temperature rise rate

**Status: `illustrative` / `unreviewed`.**

Observed in `npm run verify:m3b`: heart rate 148 bpm, ambient 42 °C, 55%
humidity, in PPE, on air. Six ticks five minutes apart:

| Callsign | t1 | t2 | t3 | t4 | t5 | t6 |
|---|---|---|---|---|---|---|
| ALPHA-1 (28, high heat tolerance) | 37.00 | 37.49 | 37.98 | 38.47 | 38.96 | 39.45 |
| BRAVO-2 (52, low heat tolerance) | 37.00 | 37.58 | 38.16 | 38.74 | 39.32 | 39.90 |

Roughly **0.5 °C per five minutes**, reaching 39.9 °C in thirty minutes. Heat
storage reaches 402 W/m² because the required sweat rate exceeds what can be
produced, so evaporative cooling saturates and the surplus goes into the body.

Directionally this is what an encapsulated firefighter working hard in extreme
heat does. The *rate* rests on two invented numbers:
`evaporative_resistance_m2kpa_w_ppe` (0.06 m²kPa/W) and the sweat-rate ceiling.

**Needs review:** whether ~0.1 °C/min is plausible under these conditions, and
what the defensible range is. Any time-to-danger figure shown to a commander is
a direct function of this rate, so it must be reviewed before Milestone 5
surfaces one.

### 17. One SCBA protection factor, provisionally set at the more conservative value

**Status: `illustrative` / `unreviewed`. PROVISIONAL — engineering picked neither
value, only the safer of two that already existed.**

"How much airborne contaminant still reaches the wearer while on air" was held as
**two different parameters with two different values**:

| Where | Parameter | Value | Used for |
|---|---|---|---|
| risk config | `scba_inhalation_protection_factor` | **0.25** | CO and PM2.5 in the environmental subscore |
| physiology config | `scba_inhaled_fraction_on_air` | **0.05** | CO uptake and PM2.5 dose accumulation |

One physical quantity, a five-fold disagreement. Now unified as a single
parameter in `config/shared-default.json`, which both models load; a model config
that redefines it is rejected at load, so they cannot drift apart again.

**Interim value: 0.25**, the more conservative of the two — it admits more
contaminant and therefore produces higher risk. Chosen only because a choice was
required to run; engineering is not competent to set it.

**Question for review:** what fraction of ambient CO and particulate actually
reaches a firefighter on air, allowing for facepiece leakage, seal quality, and
mask removal for communication? Is a single number appropriate at all, or does it
need to differ by contaminant, by mask type, or by whether the wearer has been
observed to break seal? The value may never be zero — Valoris cannot verify seal,
cylinder contents or compliance.

### 18. PPE heart-rate penalty — two candidate formulations

**Status: `illustrative` / `unreviewed`. Genuine physiological disagreement, for
arbitration.**

The Data Addendum specifies a **fixed penalty in beats per minute**:
`turnout_gear_hr_penalty_bpm` = 12 bpm, `literature_derived`, citing published
simulated-firefighting studies reporting elevated heart rate in turnout gear at
equivalent workload.

What is implemented instead is a **penalty proportional to heart-rate reserve**:
`ppe_reserve_penalty_frac_per_clo` = 0.06 per clo, so 1.8 clo removes about 11% of
the reserve — roughly 15 bpm for a 28-year-old with a 142 bpm reserve, and about
11 bpm for a 52-year-old with a 98 bpm reserve.

**The argument for the implemented version:** a fixed 12 bpm consumes a much
larger share of a 52-year-old's usable range than a 28-year-old's. Scaling with
reserve is more consistent with the rest of the model, which personalises
everything else against individual reserve.

**The argument against it:** it is invented. The addendum's 12 bpm can be pointed
at a paper; 0.06 per clo cannot be pointed at anything.

**This is a real trade-off between better physiology and defensible provenance,
and it is not an engineering call.** If the reserve-scaled form is preferred it
should be re-derived from the same literature so it can carry a citation. If the
fixed form is preferred, the personalisation loss should be accepted explicitly.

### 19. Downstream models use an upper bound on core temperature

**Status: `illustrative` / `unreviewed`.**

The Kalman estimator holds its estimate steady when heart rate drops out and grows
its variance instead. Feeding that point estimate to fatigue accumulation made a
dropout *less* pessimistic exactly as the data got worse — caught by a property
test.

Safety-relevant downstream models therefore consume an **upper confidence bound**,
estimate + `core_temp_upper_bound_sd_multiple` (currently 1) × standard deviation,
rather than the point estimate. The point estimate is what gets displayed.

**Question for review:** is one standard deviation the right margin, and should
the **risk score itself** use the upper bound rather than the point estimate? At
present the score uses the point estimate and lets the standard deviation reduce
confidence instead. Using the bound would raise every score in poor-data
conditions. Both are defensible; the choice is clinical.

### 20. Divergences from the Data Addendum, unresolved by engineering

Logged rather than decided, per instruction.

| # | Addendum specifies | Implemented | Note |
|---|---|---|---|
| 4 | `turnout_gear_hr_penalty_bpm` = 12 bpm, `literature_derived` | `ppe_reserve_penalty_frac_per_clo` = 0.06, `illustrative` | See item 18 |
| 5 | Turnout gear ≈ 2.0–2.5 clo | 1.8 clo | Below the specified range. Raising it increases evaporative resistance and heat storage, so it is not a cosmetic change |
| 6a | ALPHA-2 mild hypertension: "−5 bpm override threshold" | Not implemented | No condition-to-override mapping exists. Hypertension currently affects only the condition count |
| 6b | BRAVO-2 moderate asthma: "tighter SpO₂ **and PM2.5** thresholds" | SpO₂ tightened by respiratory risk; PM2.5 tightened only by cumulative exposure | The addendum ties tighter PM2.5 to the condition; the implementation ties it to accumulated dose. Arguably both should apply |
| 6c | CHARLIE-1: "faster heat accumulation" | Low heat tolerance tightens limits but does not accelerate accumulation | A tighter ceiling and a faster climb are different claims |
| 7 | Fatigue is a function of time on task, metabolic rate, heat storage, previous shift hours, **and hydration** | Hydration is not an input | `hydrationPct` is captured, tracked for staleness, and unused |

## References

Every citation below is recorded so that a `literature_derived` claim can be
checked. **Verification status is stated for each, and none has been verified
against the primary source by the author of this codebase.** Honesty rule 8 is
"cite every model, no fabricated references" — recording an unverified
transcription as unverified is the only way to keep that rule while still being
useful.

| Ref | Source | Used for | Verification status |
|---|---|---|---|
| **[1]** | ISO 7933 — *Ergonomics of the thermal environment: analytical determination and interpretation of heat stress using calculation of the predicted heat strain* | Structure of the reduced heat-balance model in `lib/physiology/heat-strain.ts` | **Structure only, from general knowledge.** The implementation is explicitly NOT conformant and omits the standard's iterative integration and clothing sub-models. No parameter in the shipped config claims `literature_derived` from this standard. |
| **[2]** | Buller MJ et al., *Estimation of human core temperature from sequential heart rate observations*, Physiological Measurement, 2013 | Every `kalman_*` parameter, and the filter structure in `lib/physiology/core-temp-kalman.ts` | **UNVERIFIED TRANSCRIPTION. The coefficient values were written from memory and have not been checked against the paper.** The method is published; the specific numbers must be confirmed before any use. Validation in the source is against rectal thermometry in laboratory conditions, NOT firefighters in PPE. |
| **[3]** | Barkjohn KK et al., *Correction and Accuracy of PurpleAir PM2.5 Measurements for Extreme Wildfire Smoke*, Sensors 2022, **22**, 9669 — with corrigendum Sensors 2024, **24**, 7871 | PM2.5 correction, Milestone 3d, **not yet implemented** | **Quoted verbatim from the Sensor Integration Spec.** Not yet read. |
| **[4]** | Karvonen MJ, Kentala E, Mustala O, *The effects of training on heart rate*, 1957 | Heart-rate reserve method in `lib/physiology/cardiac.ts` | **Attribution of the method only, from general knowledge.** No shipped parameter claims `literature_derived` from it. The PPE penalty layered on top is invented — see item 18. |
| **[5]** | Coburn RF, Forster RE, Kane PB — carboxyhaemoglobin kinetics, 1965 | Named for **contrast** in `lib/physiology/toxic-exposure.ts`, which explicitly does NOT implement it | **Named only.** The implementation is a first-order approximation with invented coefficients and says so. |
| **[6]** | WESAD; PAMAP2; PhysioNet | Tier B signal texture, **not yet implemented** | **Dataset names from the Data Addendum.** Full citations still to be obtained. Nothing in the build claims Tier B. |
| **[7]** | Firefighter physiological studies named in the Data Addendum: Horn, Blevins, Fernhall, Smith; Sandsund, Aamodt, Renberg (2024); Rodríguez-Marroyo; and two further unnamed 2023/2026 datasets | Nothing yet — these are the outreach targets for moving Tier C toward validation | **Author names only, as given in the addendum.** No full citations, no papers read. Logged in `docs/DATA_PROVENANCE.md`. |

**Nothing in this codebase may be marked `validated` on the strength of any
reference above.** A citation establishes that a method is published. It does not
establish that this implementation of it is correct, nor that it applies to
firefighters in PPE.

## Sign-off checklist

No item below may be ticked by an engineer.

| # | Item | Reviewer | Date | Outcome |
|---|---|---|---|---|
| 1 | Estimated core temperature may/may not drive a hard override | | | |
| 2 | Age-adjusted max HR method accepted or replaced | | | |
| 3 | SpO2 baseline capture method and low-saturation accuracy | | | |
| 4 | Respiratory-risk SpO2 shift magnitude | | | |
| 5 | Heat-tolerance limit shifts, including upward relaxation | | | |
| 6 | Previous-shift fatigue carry-over and double counting | | | |
| 7 | Condition severity model | | | |
| 8 | Cumulative exposure index definition | | | |
| 9 | SCBA protection factor | | | |
| 10 | Heat index method | | | |
| 11 | Composite weights and band cut-offs | | | |
| 12 | SpO2 override confirmation and fail-safe default | | | |
| 13 | Projected values for dropped sensors, and whether they may fire an override | | | |
| 14 | Additive vs. multiplicative profile personalisation (near-constant 8.8–11.1 point offset) | | | |
| 15 | Two unlabelled core temperature limits (38.0 °C duration ceiling vs 39.5 °C override) | | | |
| 16 | Modelled core temperature rise rate (~0.5 °C per five minutes in extreme conditions) | | | |
| 17 | SCBA inhaled fraction — provisionally 0.25, was 0.25 vs 0.05 | | | |
| 18 | PPE heart-rate penalty — fixed 12 bpm vs reserve-scaled 0.06/clo | | | |
| 19 | Upper-bound margin on core temperature, and whether scoring should use it | | | |
| 20 | Kalman coefficient values — verify against ref [2] before any use | | | |
| 21 | Turnout gear insulation 1.8 clo vs the specified 2.0–2.5 clo | | | |
| 22 | Condition-specific threshold shifts (hypertension HR, asthma PM2.5) | | | |
| 23 | Hydration as a fatigue input | | | |

Reviewer name, registration number and date are required for each row. Until
every row is complete, all parameters remain `illustrative` / `unreviewed` and
Valoris remains simulation-only.
