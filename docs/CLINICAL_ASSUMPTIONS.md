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

Reviewer name, registration number and date are required for each row. Until
every row is complete, all parameters remain `illustrative` / `unreviewed` and
Valoris remains simulation-only.
