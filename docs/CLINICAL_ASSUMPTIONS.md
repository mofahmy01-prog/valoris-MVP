# Clinical assumptions

**SIMULATION MODE — NOT FOR OPERATIONAL USE.**

Valoris is a research prototype. It is not a medical device, it is not clinically
validated, and nothing in this document has been reviewed by a clinician.

Every threshold in `config/risk-default.json` ships as:

- `sourceStatus: "illustrative"`
- `clinicalReviewStatus: "unreviewed"`

Nothing may be promoted to `validated` or `approved_for_pilot` without a named
occupational physician signing the checklist at the end of this document.

---

# BLOCKING CLINICAL ITEMS — IN PRIORITY ORDER

Read these first. Everything below this section is detail.

| Priority | Item | Why it blocks | Detail |
|---|---|---|---|
| **1** | **Carbon monoxide has no hard override** | CO is the classic firefighter incapacitator — fast onset, no warning, steep dose-response. Every other danger in this system has an unconditional override. CO has only a weighted subscore, which can be diluted to nothing by low scores elsewhere. That is the wrong mechanism for a hazard where the margin between "accumulating" and "minutes left" is narrow. | item 25 |
| **2** | **No false-alarm budget** | Nothing can be calibrated, and no sensitivity claim can be made, until someone states the operating point. | item 23 |
| **3** | **Kalman coefficients unverified** | Seven transcribed numbers drive every core temperature in the system. | item 20, `DATA_PROVENANCE.md` blocking item 1 |
| **4** | **Core temperature override discrepancy** | Two source documents disagree, 39.5 °C vs 40 °C. The stricter value is implemented; the disagreement must not persist silently. | item 26 |
| **5** | **PurpleAir correction coefficients unverified** | A wrong correction moves every asthma-related alert. | `DATA_PROVENANCE.md` blocking item 2 |

---

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

### 21. The core temperature estimator is environment-blind — should the composite compensate?

**Status: `illustrative` / `unreviewed`. Single question for review.**

Switching to the published sequential Kalman estimator (item 20, reference [2])
made the model **markedly less alarming** under identical inputs, and made core
temperature **blind to ambient conditions**.

Measured, same demo inputs both times — HR 148 bpm, ambient 42 °C, 55% humidity,
in PPE, six ticks five minutes apart:

| | Previous invented blend | Published Kalman estimator |
|---|---|---|
| ALPHA-1 final core temp | 39.45 °C | **38.43 °C** |
| BRAVO-2 final core temp | 39.90 °C | **38.43 °C** |
| Firefighters ending `CRITICAL` | 5 of 6 | **0 of 6** |

Two distinct effects:

1. **Less alarming.** The filter converges toward the core temperature implied by
   the observed heart rate and settles there, rather than integrating heat storage
   upward without limit. Nobody reaches the core-temperature override.
2. **Environment-blind.** The published model takes heart rate and nothing else.
   **148 bpm produces the same estimate at 20 °C as at 60 °C.** For wildfire work,
   where radiant load and encapsulating PPE are the dominant thermal stressors,
   that is a significant blind spot.

**The signal has not been lost — it has moved.** The reduced ISO 7933 heat balance
still runs, still sees ambient temperature, humidity, radiant load, air velocity
and clothing, and is still personalised by heat tolerance. It reports heat storage
(W/m²), predicted sweat rate, and an allowable exposure duration. At present those
outputs are *displayed* but carry **no weight in the composite risk score** — the
score's thermal input is the core temperature estimate, which no longer sees any
of it.

**The question for review, as one question:**

> Given that core temperature is now heart-rate-only and environment-blind, should
> the risk engine weight heat storage and allowable exposure duration more heavily
> to compensate?

Supporting detail for whoever answers it:

- Heat storage and `dlimMin` are already computed per firefighter, personalised,
  and available to the engine — no new modelling is required, only a weighting
  decision.
- The alternative is to accept a less alarming model on the grounds that the
  previous one was invented and alarmism is not accuracy.
- A third possibility: keep the composite as it is and let allowable duration
  drive a separate `rotate` recommendation rather than the score.

**Engineering has not reweighted anything and will not.** Composite weights are
`weight_physiological` 0.40, `weight_environmental` 0.30, `weight_proximity` 0.20,
`weight_profile` 0.10, all `illustrative`, all unchanged.

### 22. Outcome capture — outcomes are interventional, not observational

**Status: design constraint. Must be settled before a pilot, not after.**

Once Valoris is advising a commander, **the recommendation changes the outcome it
would be evaluated against.** A firefighter withdrawn on a `CRITICAL` band who then
suffers nothing is not evidence the band was wrong — it may be evidence the
withdrawal worked.

Any use of the observation log as training or calibration data must therefore:

1. **Record whether the recommendation was acted on.** `CommanderAction` already
   captures acknowledge / accept / reject / override with a mandatory reason, so
   the information exists; it must be joined to the outcome, not ignored.
2. **Treat accepted recommendations as censored observations**, in the survival-
   analysis sense: the event was prevented from occurring, not observed not to
   occur.
3. **Never train on the naive pairing of (inputs → outcome).** Doing so teaches
   the model that `CRITICAL` bands are followed by nothing happening, and the
   model learns to under-alert. This failure is invisible in aggregate accuracy
   and lethal in effect.

Rejected and overridden recommendations are the most informative rows in the
dataset, because those are the cases where the model's advice was *not* followed
and the outcome was observed. They will also be rare.

**Question for review:** is a commander-facing system that changes its own outcome
distribution evaluable at all from observational pilot data, or does establishing
sensitivity require a design where some recommendations are deliberately withheld?
That is an ethical question as much as a statistical one, and it is not
engineering's to answer.

### 23. Outcome capture — the false-alarm budget

**Status: BLOCKING for any calibration claim. Requires a number from Ismail.**

Most firefighters on most incidents experience nothing. Against that base rate a
model that predicts "nothing" always will score extremely well on accuracy, and be
worthless.

Valoris therefore cannot be evaluated on accuracy, and cannot be tuned at all
until someone states the operating point:

> **At what false-alarm rate is a given sensitivity worth having?**

Concretely, the number needed is something of the form: *"I will accept N
unnecessary `CRITICAL` alerts per 100 firefighter-shifts in order to catch X% of
genuine heat-illness events."*

Why this cannot be an engineering decision:

- It trades a real operational cost — crews stood down unnecessarily, commander
  trust eroded, alerts ignored — against a real clinical harm.
- Alert fatigue is itself a safety failure. A model that cries wolf gets muted,
  and a muted model has sensitivity zero.
- The right answer almost certainly differs by band. A false `CAUTION` costs
  little; a false `CRITICAL` costs a lot.

Until that number exists, every band cut-off in `config/risk-default.json`
(25 / 50 / 75) remains an invented placeholder, and no statement about the model's
sensitivity or specificity may be made to anyone.

### 24. Threshold divergences in the safety review prompt

`PROMPT_2_CLAUDE_REVIEW.md` lists hard overrides that differ from the ones built
from the main build prompt. Logged, not reconciled — these are threshold decisions.

| Override | Main build prompt / implemented | Review prompt |
|---|---|---|
| SpO₂ | 88% baseline, personalised upward by respiratory risk | "< 88" |
| Core temperature | **39.5 °C**, personalised by heat tolerance | "**≥ 40 °C**" |
| Heart rate | ≥ 97% of age-adjusted max | same |
| Fall detected | yes | same |
| Escape route | blocked **and** fire front within 150 m | "exit blocked + high fire load" |
| **CO concentration** | **no CO override exists** | "**CO > 80 ppm**" |
| SCBA pressure | ≤ 20% | not listed |
| Manual mayday | yes | not listed |

Two of these matter:

- **There is no CO hard override at all.** CO currently contributes only through
  the environmental subscore, attenuated by SCBA. A direct CO override at a stated
  concentration is a different and stricter safety behaviour, and the review prompt
  assumes one exists.
- **Core temperature override is 39.5 °C, not 40 °C.** The implemented value is
  stricter, so this is the safe direction, but the two documents disagree.

**Needs review:** which set is authoritative, whether a CO override should exist
and at what concentration, and whether it should be gated by SCBA status.

### 25. Carbon monoxide has no hard override — BLOCKING ITEM 1

**Status: `illustrative` / `unreviewed`. Highest-priority clinical decision in the
build.**

Every other danger Valoris models has an unconditional hard override: SpO₂, core
temperature, heart rate, fall, SCBA pressure, blocked escape route, manual mayday.
**Carbon monoxide has none.**

What CO does today: it contributes to the environmental subscore, weighted at
`env_weight_co` = 0.40 within a subscore weighted at 0.30 of the composite — so a
maximum CO contribution moves the total score by at most 12 points. It is then
attenuated by SCBA on-air status. **A firefighter in a lethal CO atmosphere with
otherwise unremarkable readings can therefore sit in `CAUTION`.**

That is the wrong mechanism for this hazard. CO has fast onset, no sensory
warning, and a steep dose-response curve; the margin between "accumulating" and
"minutes left" is narrow. A weighted average is designed to let one input be
outvoted by others, which is exactly what must not happen here.

**Three questions for review:**

1. **Should CO have a hard override, and at what ppm?**
2. **Should the trigger be instantaneous concentration, accumulated
   carboxyhaemoglobin, or both with different thresholds?** Valoris already
   estimates COHb (`cohb_pct_per_ppm_hour_at_rest`, first-order, invented
   coefficients — not Coburn-Forster-Kane). An instantaneous trigger catches a
   sudden plume; an accumulated trigger catches a long exposure at a
   moderate concentration. They fail in opposite directions.
3. **Does SCBA on-air status gate it — and if so, does off-air lower the
   threshold, or only accelerate accumulation?** The shared
   `scba_inhaled_fraction_on_air` (currently 0.25, itself provisional per item 17)
   already attenuates uptake. Whether it should also be permitted to suppress an
   override is a different question, and gating a hard override on a
   protective-equipment status Valoris cannot verify is exactly the pattern the
   safety rules warn against.

**On the 80 ppm figure.** `PROMPT_2_CLAUDE_REVIEW.md` lists an override at
`CO > 80 ppm`. **That number came from the founder, not from literature**, and
must be treated as illustrative until sourced. It is recorded here so it is not
mistaken for a cited threshold; no parameter in the shipped config uses it.

**Nothing has been implemented.** Adding a CO override changes the band of every
firefighter in a smoke atmosphere and is not an engineering decision.

### 26. Core temperature override — 39.5 °C or 40 °C? — BLOCKING ITEM 4

**Status: discrepancy between source documents. Stricter value implemented,
pending resolution.**

| Source | Value |
|---|---|
| Main build prompt / `config/risk-default.json` (**implemented**) | **39.5 °C** |
| `PROMPT_2_CLAUDE_REVIEW.md` | 40 °C |

The implemented value is `override_core_temp_critical_c` = 39.5 °C, personalised
by heat tolerance via `heat_tolerance_core_temp_shift_c` = 0.5 °C — so it fires at
39.0 °C for a low-heat-tolerance firefighter and 40.0 °C for a high-tolerance one.

**The stricter value has been kept**, on the principle that where two documents
disagree about a safety threshold the tighter one holds until someone decides.
Consequence: alerts fire earlier and more often than the review prompt expects,
which is the safe direction but is a real difference in behaviour.

**Needs review:** which figure is correct; whether personalisation should be able
to relax it upward to 40.0 °C at all (see item 5); and whether the threshold
should differ for an *estimated* core temperature versus a measured one, given
that nothing in Valoris measures it.

**This must not persist silently.** It is a disagreement between two documents
both treated as authoritative, and it currently resolves by engineering
preference rather than clinical judgement.

### 29. Glucose — hypoglycaemia override and interstitial lag correction

**Status: `illustrative` / `unreviewed`. Every number below is invented.**

The diabetes module now functionally exists. Before Milestone 3e, BRAVO-1's type 1
diabetes affected only the declared-condition count — it had no effect on any
alert. Glucose now has its own scoring term and a hard override, but only for a
firefighter flagged `glucoseMonitored`.

| Parameter | Value | Note |
|---|---|---|
| `glucose_hypo_override_mmol_l` | 3.5 mmol/L | **Fires a hard override.** The single most important number in the diabetes config, and it has no source. |
| `glucose_low_mmol_l` | 4.0 mmol/L | Low-glucose contribution reaches maximum |
| `glucose_ideal_low_mmol_l` | 6.0 mmol/L | Below this, low glucose starts contributing |
| `glucose_hyper_low_mmol_l` | 10 mmol/L | High-glucose contribution starts |
| `glucose_hyper_high_mmol_l` | 15 mmol/L | High-glucose contribution reaches maximum |
| `lag_correction_caution_mmol_l` | −0.3 mmol/L | Applied when falling, in the caution band |
| `lag_correction_danger_mmol_l` | −0.5 mmol/L | Applied when falling, in the danger band |

**On the lag correction.** CGM measures interstitial fluid, not blood, and lags it
by roughly 5–15 minutes. During a rapid fall — the wildfire deployment scenario —
the displayed value overstates blood glucose, so the correction is downward. It is
applied **only when glucose is falling**: correcting a stable reading downward
would manufacture hypoglycaemia that is not happening.

**Needs review:**

1. Is 3.5 mmol/L the right override threshold, and should it differ for a
   firefighter under heavy exertion, where symptoms present differently?
2. Are −0.3 and −0.5 mmol/L defensible corrections, and should the magnitude
   scale with the trend rate rather than sitting in two bands?
3. Should hyperglycaemia contribute at all during a fireground deployment, or is
   it purely a post-incident concern?
4. Should a firefighter with type 1 diabetes and a **failed** CGM be deployed at
   all? Valoris currently reports `UNKNOWN` and leaves the decision with the
   commander, which is correct behaviour but may not be correct policy.

### 30. Glucose staleness uses a CGM cadence, not the system default

**Status: `illustrative` / `unreviewed`.**

CGM reports roughly every five minutes, so the system-wide 60-second stale and
120-second missing thresholds would mark every normal reading stale and then
missing. Glucose therefore has its own: `glucose_stale_after_sec` = 420 (7 min)
and `glucose_missing_after_sec` = 900 (15 min, about three missed cadences).

Separately, total latency above `max_usable_total_latency_sec` = 1800 s (30 min)
stops glucose contributing at all and the module reports `UNKNOWN`. At the Dexcom
standard UK delay of three hours, **glucose is never usable on a fireground** —
which is the honest outcome, not a bug.

**Needs review:** the two cadence thresholds, and the 30-minute usability limit.

### 31. Two defects found while wiring glucose, both fixed

Recorded because both are instances of failure modes worth watching for
elsewhere.

**A reassuring reading diluted the others.** Glucose entered the physiological
subscore as a weighted mean term, so a *healthy* glucose reading pulled the
average of heart rate, SpO₂ and core temperature down — a monitored firefighter
with normal glucose scored lower than an identical unmonitored colleague. **More
monitoring must never make someone look safer.** The subscore is now floored at
its no-glucose value, so an abnormal reading is fully effective and a reassuring
one cannot wash out another channel. This is the same dilution mechanism that
makes the missing CO override (item 25) dangerous.

**A dead CGM read SAFE.** A monitored firefighter whose sensor had been silent for
three hours scored `SAFE`, because glucose was not in the critical-channel set.
For someone wearing a CGM, hypoglycaemia is their defining risk, so an absent
glucose reading now forces confidence to `low` and the band away from `SAFE`,
exactly as an absent heart rate does.

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
| 24 | Environment-blind core temperature — should heat storage carry more weight? | | | |
| 25 | Outcomes are interventional; censoring and study design | | | |
| 26 | **False-alarm budget — blocking for any calibration claim** | | | |
| **27** | **CO hard override — BLOCKING ITEM 1. Should one exist, at what ppm, on concentration or COHb or both, and does SCBA gate it?** | | | |
| **28** | **Core temperature override 39.5 °C vs 40 °C — BLOCKING ITEM 4. Which document is authoritative?** | | | |
| 29 | Glucose — hypoglycaemia override threshold and interstitial lag correction | | | |
| 30 | Glucose staleness thresholds for a 5-minute CGM cadence | | | |

Reviewer name, registration number and date are required for each row. Until
every row is complete, all parameters remain `illustrative` / `unreviewed` and
Valoris remains simulation-only.
