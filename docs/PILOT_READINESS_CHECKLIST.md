# Pilot readiness checklist

**SIMULATION MODE — NOT FOR OPERATIONAL USE.**

**Valoris is not pilot-ready and nothing below is complete.** This document exists
so the gates are written down before anyone is tempted to skip one, not to record
progress toward them.

A pilot means real firefighters, real physiological data and real decisions. Every
gate here must be closed first. Any single unchecked item in section 1 or 2 blocks
a pilot outright.

---

## 1. Clinical governance — BLOCKING

| # | Gate | Status |
|---|---|---|
| 1.1 | Every item in `docs/CLINICAL_ASSUMPTIONS.md` signed off by a named occupational physician with registration number | ☐ **None signed** |
| 1.2 | No parameter remains `illustrative` where it drives an alert a commander acts on | ☐ **All are illustrative** |
| 1.3 | Reference [2] coefficient values verified against the primary source — they drive every core temperature estimate and are currently an unverified transcription | ☐ |
| 1.4 | Band cut-offs (25 / 50 / 75) calibrated rather than invented | ☐ |
| 1.5 | A decision on whether personalisation is additive or compounding (assumption 14) | ☐ |
| 1.6 | The two core temperature limits given distinct commander-facing labels (assumption 15) | ☐ |
| 1.7 | Agreed sensitivity target at a stated false-alarm budget — a clinical decision, not an engineering one | ☐ |

## 2. Data protection and legal — BLOCKING

| # | Gate | Status |
|---|---|---|
| 2.1 | **Business Associate Agreement with every service in the pipeline** — hosting, logging, analytics, error reporting, backups. Glucose readings combined with identity are PHI. So are outcomes. So is a core temperature estimate attached to a named firefighter. | ☐ |
| 2.2 | Data Protection Impact Assessment (UK GDPR) — health data is special category, and continuous physiological monitoring of employees is high risk | ☐ |
| 2.3 | Lawful basis established for processing employee health data, with the works council or union consulted | ☐ |
| 2.4 | Retention and deletion policy. `Observation` and `AuditEvent` are append-only by design, which conflicts with erasure rights and needs a documented resolution | ☐ |
| 2.5 | Access control — who may see an individual's physiological history, and for how long after an incident | ☐ |
| 2.6 | Dexcom Limited Access or Partner agreement, if glucose is in scope | ☐ |
| 2.7 | PurpleAir attribution in the report footer, per their licence | ☐ |
| 2.8 | Position 24 of the addendum: real crew positions and outcomes from any historical incident are not public and must never be invented, including in a replay | ☐ |

## 3. Product gates before a pilot generates useful evidence

| # | Gate | Status |
|---|---|---|
| 3.1 | **Outcome capture at incident close** — without it a pilot produces no evidence. See `docs/ROADMAP.md` item 1 | ☐ |
| 3.2 | Profile and config snapshots stored per assessment, so a historical score can be reproduced (`docs/ROADMAP.md` item 3) | ☐ |
| 3.3 | Commander training material covering what `UNKNOWN` means, and that a band falling as a sensor drops out is a red flag rather than an improvement | ☐ |
| 3.4 | A documented procedure for what a commander does when Valoris and their own judgement disagree — Valoris never withdraws anyone | ☐ |
| 3.5 | Sensor hardware selection, wear compliance plan, and charging or battery policy | ☐ |
| 3.6 | Defined failure mode when the system goes down mid-incident | ☐ |

## 4. Claims discipline

The Sensor Integration Spec fixes the wording. These must be true at pilot, and
they are the only forms permitted publicly.

**Accurate:**

> Environmental inputs use real historical data from NIFC fire perimeters,
> Open-Meteo weather, and the PurpleAir sensor network, with EPA correction
> applied for wildfire smoke conditions. Glucose monitoring is developed against
> the Dexcom sandbox API using the production endpoint structure.

**Never say:**

- "Integrated with Dexcom" — the integration is with their sandbox
- "Real-time glucose monitoring" — requires partner status not held
- "Using PurpleAir data" without mentioning the correction
- Anything implying Dexcom, PurpleAir, NIFC or NASA endorse or partner with Valoris
- That any external guideline validates the composite model

| # | Gate | Status |
|---|---|---|
| 4.1 | Deck, website and all written material audited against the wording above | ☐ |
| 4.2 | Every screen and export carries its data tier and the simulation banner | ☐ **Implemented in the API; no dashboard exists yet** |
