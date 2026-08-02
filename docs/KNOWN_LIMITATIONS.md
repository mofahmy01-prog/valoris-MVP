# Known limitations

**SIMULATION MODE — NOT FOR OPERATIONAL USE.**

An honest list. Current as of Milestone 1 (risk engine only).

## Not built yet

Milestones 2–6 are not started. There is no database, no API, no simulator, no
map, no dashboard, no forecasting, no recommendations, no audit log and no
report. The web app currently renders only the model assumptions table.

## Fundamental

1. **Nothing here is clinically validated.** Every threshold is invented and
   flagged `illustrative` / `unreviewed`. See `docs/CLINICAL_ASSUMPTIONS.md`.
2. **No real sensors.** All input is simulated. There are no vendor integrations
   and none are planned for this MVP.
3. **Estimated core temperature is not measured.** It is treated as usable
   anyway, which is the single largest source of error in the physiological
   subscore.
4. **Pulse oximetry bias is not corrected.** Known accuracy differences across
   skin tones and at low saturation are not modelled.
5. **No calibration data exists.** The weights, ramps and band cut-offs have
   never been fitted against outcomes, because there are no outcomes.

## Engine behaviour worth knowing before you trust an output

6. **Missing inputs are scored as worst case.** An absent CO reading contributes
   the maximum, not zero. This makes a degraded sensor picture look worse, which
   is intended, but it means the score is not comparable between a well-
   instrumented and a poorly-instrumented firefighter.

7. **A missing critical vital does not always show `UNKNOWN`.** The rule is:
   band = the *more severe* of the composite band and `UNKNOWN`. So a firefighter
   with a dropped heart-rate sensor in quiet conditions reads `UNKNOWN`, but one
   with a dropped sensor next to an advancing fire front still reads `HIGH` or
   `CRITICAL`. Collapsing everything to `UNKNOWN` would hide real danger. The
   consequence is that `UNKNOWN` is not a reliable indicator that data is
   missing — read `dataQuality.missingInputs` for that.

8. **Losing an input can lower the band in exactly one case:** when the lost
   input was the sole evidence for a hard override. A firefighter at an estimated
   40.2 °C reads `CRITICAL`; if that sensor then drops out, the reading is gone
   and the band falls back to whatever the remaining evidence supports, never
   below `UNKNOWN` and never `SAFE`. The engine is stateless and has no latch or
   hysteresis. **A commander must treat a band that falls at the same moment a
   sensor drops out as a red flag, not as improvement.** This is covered by a
   named test in `lib/risk/risk.test.ts`.

   *Planned resolution — see "Sensor dropout projection" below.*

9. **The engine is stateless.** It has no memory between calls. Trends,
   confirmation windows and latching all have to be supplied by the caller.
   The SpO2 three-reading confirmation is passed in as `recentSpo2Pct`; if it is
   absent, a single breaching reading fires the override.

10. **`restingHrBpm`, `hydrationPct`, `respRatePerMin`, `windSpeedMs`,
    `windDirDeg` and `distanceToSafeZoneM` are captured but not scored.** They
    are carried for display, staleness tracking and later milestones. Their
    absence still degrades confidence; it does not change the score.

11. **Time on task is counted twice in spirit.** It appears in the physiological
    subscore, and previous-shift hours appear in both the fatigue carry-over and
    the profile subscore.

12. **High heat tolerance relaxes limits above the population value.** This is
    the intended personalisation and also the most dangerous direction the model
    can move in. Flagged for clinical review.

13. **Position has no freshness tracking.** `Position` carries no
    `lastUpdatedMs`, so a frozen GPS or SCBA telemetry feed is invisible to the
    data-quality logic. Absent SCBA pressure or fire-front distance is instead
    treated as worst case, which fires the SCBA hard override on missing data.

14. **`configHash` is FNV-1a, not a cryptographic hash.** It detects accidental
    configuration drift. It is not tamper-evident.

15. **Condition count, not severity.** Four mild conditions score the same as one
    severe one.

## Sensor dropout projection — decided, not yet built

Today a channel that stops reporting is scored as **worst case**. That is safe
but uninformative, and it is the cause of limitations 6 and 8 above.

**Decision (agreed before Milestone 2):** a channel that goes dark will instead
be *projected* from that firefighter's own recent measured readings, under one
governing rule:

> **An estimate may only ever move in the dangerous direction.**

The imputed value is the worse of the last measured value and that value
extrapolated along its recent measured slope. A rising core temperature keeps
rising; a falling heart rate is held at its last measured value rather than
assumed to keep recovering. An estimate can therefore never improve a
firefighter's picture — it can only continue a deterioration that was actually
being measured.

Scope and constraints:

- **Own history only.** Projection uses only that individual's own prior
  measured readings. Valoris will *not* estimate a missing physiological value
  from ambient temperature, workload, proximity or crewmates' readings. That
  would mean inventing an unvalidated physiological model, and it was explicitly
  ruled out.
- **Guarded like `timeToDangerMin`.** Minimum history depth, consistent slope
  sign across the window, and a decay horizon after which the projection expires
  back to worst case. A projection may not run indefinitely on a stale slope.
- **Never rendered as a measurement.** Projected values carry their own input
  state and glyph, distinct from measured and stale. Confidence still drops.
- **Still never `SAFE`.** A projected critical vital cannot produce a `SAFE`
  band.
- **No new scoring path.** Projection feeds the existing `assessRisk`, using the
  same least-squares machinery as Milestone 5's forecasting.

**Where it lands:** Milestone 5, alongside forecasting. Milestone 2's
append-only `Observation` table is the rolling history it reads from, so no
engine change is needed before then.

**Until it lands**, dropouts behave as described in limitations 6 and 8.

## Scope

16. **No autonomous action, ever.** Valoris recommends. The commander decides.
    There is no withdrawal mechanism and there will not be one.
17. **No machine learning anywhere.** Deterministic rules only, so that any
    output can be traced to named thresholds.
18. **No LLM decides safety.** If an assistant is added later it may only
    rephrase output the deterministic engine has already produced.
