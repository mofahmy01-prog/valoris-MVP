# Roadmap — decisions logged, not yet built

**SIMULATION MODE — NOT FOR OPERATIONAL USE.**

Deliberate deferrals. Each entry records the decision, why it matters, and what
it blocks. Nothing here is implemented.

---

## 1. Outcome capture — REQUIRED BEFORE ANY PILOT

**Milestone 6. Decision must be made before a pilot, not after.**

At incident close, per firefighter, record whether anything actually happened:

- `nothing` — completed the incident without event
- `rehab_required` — stood down for rehabilitation
- `heat_exhaustion` — heat illness, any severity
- `near_miss` — no injury, but a credible one was avoided
- `medical_attention` — assessed or treated by a medic
- `hospital_transport`
- `unknown` — not recorded, deliberately distinct from `nothing`

**Why this is the gating item.** Without an outcome column the observation log is
an unlabelled time series. It can show what the model *said*, never whether the
model was *right*. Every calibration question already logged in
`docs/CLINICAL_ASSUMPTIONS.md` — the band cut-offs, the additive-vs-multiplicative
question (item 14), the core temperature rise rate (item 16) — is unanswerable
without outcomes. Adding the column after a pilot means the pilot generates no
usable evidence.

**Why it must be decided before, not during.** Outcomes have to be captured
prospectively by whoever closes the incident. They cannot be reconstructed later
from an observation log, and a retrospective survey of "what happened that day"
is not evidence.

### Constraints that must be designed in from the start

1. **`unknown` is not `nothing`.** An unrecorded outcome must never collapse into
   a negative case. Absent labels bias any model toward "nobody gets hurt",
   which is the same failure as absent sensor data reading as `SAFE`.
2. **Outcomes are interventional, not observational.** Once Valoris is advising a
   commander, the recommendation changes the outcome. A firefighter withdrawn on
   a `CRITICAL` band who then suffers nothing is not evidence the band was wrong
   — it may be evidence the withdrawal worked. Any training on this data must
   record **whether the recommendation was acted on**, which
   `CommanderAction` already captures, and treat accepted recommendations as
   censored observations. Ignoring this produces a model that learns to
   under-alert.
3. **Base rates will be extremely low.** Most firefighters on most incidents
   experience `nothing`. A model optimising accuracy on that distribution
   predicts `nothing` always. Any evaluation must be framed around
   sensitivity at a fixed, clinically agreed false-alarm budget, and that budget
   is a clinical decision.
4. **Outcome is PHI.** It is health information about an identified person, and
   it attracts the same Business Associate Agreement requirements as glucose
   data. See `docs/PILOT_READINESS_CHECKLIST.md` (not yet written).
5. **Append-only, attributed, and reason-carrying.** Same treatment as
   `AuditEvent`: who recorded it, when, and no update path. An outcome edited
   after the fact is worthless as evidence.
6. **Never auto-derive an outcome from the model's own output.** A `CRITICAL`
   band is not an outcome. Circularity here would be invisible and fatal.

**Blocks:** any threshold calibration, any claim that the model is validated,
any move of a parameter from `illustrative` toward `validated`, any pilot.

---

## 2. Model-swap seam — `RiskModel` interface

`assessRisk` is currently a bare exported function with two production call
sites. There is no `RiskModel` interface, no `predict` / `explain` / `version` /
`validateInput` / `uncertainty` surface, and no `RuleBasedRiskModel` class.

The mechanical cost of introducing one is small today and grows with every call
site. The substantive gap is that three of those five members do not exist in any
form:

- `validateInput` — the engine currently accepts whatever it is given and
  handles absence internally. There is no rejection path and no input contract
  separate from TypeScript's types.
- `uncertainty` — `DataQuality.confidence` is a three-level ordinal derived
  purely from staleness and missingness. It carries no notion of model
  uncertainty, no interval, and nothing about individual variability. Clinical
  assumption 15 (core temperature estimation) already needs this.
- `version` — exists as data (`modelVersion`, `configHash`) but not as a
  member of an interface.

**Blocks:** running a second model implementation alongside the rule-based one,
which is the only honest way to evaluate a learned model against the deterministic
baseline.

---

## 3. Reproducibility gaps for training data

The `Observation` table retains the raw sensor values, per-channel freshness, the
derived physiology and the position state. Three inputs are **not** recoverable
from the database alone:

1. **Profile snapshot.** `FirefighterProfile` is mutable (`updatedAtUtc
   @updatedAt`, and the seed upserts in place). An assessment references the
   profile by id, so if age, fitness, declared conditions or the cumulative
   exposure indices change, the historical input state cannot be reconstructed.
   **This is the most damaging of the three** — the profile is what makes the
   score personalised, so an unreproducible profile makes an unreproducible score.
2. **Configuration content.** Only `configHash` and `modelVersion` are stored,
   not the parameter values behind them. The hash detects drift but cannot
   reverse it. Values live in git, and nothing in the database maps a hash back
   to them.
3. **Fire perimeter geometry.** Only the derived `distanceToFireFrontM`, the
   provider key and the front's confidence are stored. The engine's input is
   therefore reproducible, but the geometry it came from is not auditable.

Proposed fix, when outcome capture is built: write an immutable
`profileSnapshotJson` and `configSnapshotJson` onto each `RiskAssessmentRecord`,
and store the perimeter ring alongside the incident. Costs storage, buys exact
replay.

---

## 3b. Revised Milestone 3 sequence

Agreed order, superseding both the addendum's numbering and the earlier working
sequence:

| Stage | Scope | State |
|---|---|---|
| 3a | Tier C physiology models | **Done** |
| 3b | Six profiles wired to 3a | **Done** |
| 3c | Tier A/B/C provenance labelling | **Done** |
| 3d-prime | Kalman core temp, citations, confidence effect, SCBA unification | **Done** |
| 3d | PurpleAir EPA correction | **Done** |
| 3e | Dexcom sandbox behind a vendor-agnostic `CgmAdapter` | Next |
| 3f | Tier B noise models | Not started |
| 3g | Tier A fixture loader + `scripts/fetch-historical.ts` | Not started |
| 3h | Five live scenarios + injection controls | Not started |
| 3i | Palisades replay | Not started — the credibility artefact, do not drop |

## 4. Unscheduled items from the Data Addendum

The addendum's revised Milestone 3 sequence was 3c Tier B noise models, 3d Tier A
fixture loader, 3e five live scenarios, 3f Palisades replay. The working
sequence renumbered 3c–3e to provenance, PurpleAir and Dexcom, which leaves these
without a slot:

- **Tier B noise models** — WESAD/PAMAP2-derived signal texture in
  `data/profiles/noise-models.json`, applied over Tier C output. Until this
  exists nothing may claim Tier B, and the provenance strip says so explicitly.
- **Tier A fixture loader + `scripts/fetch-historical.ts`** — committed
  Palisades 2025 fixtures with provenance, checksums and licence records.
- **Five live scenarios and injection controls** — the original Milestone 3
  content: baseline, wind shift, diabetic glucose fall, asthmatic in plume,
  sensor dropout.
- **Palisades replay mode** — described in the addendum as the strongest
  credibility artefact available.

---

## 5. Documents required but not written

- `docs/DATA_PROVENANCE.md` — outreach log: who was contacted, when, what was
  requested, what came back. Required by both addenda.
- `docs/PILOT_READINESS_CHECKLIST.md` — HIPAA/BAA gate, required by the sensor
  integration spec before any real deployment.
- `docs/DEMO_SCRIPT.md` — required by the main build prompt.
- A numbered reference list. Honesty rule 8 is "cite every model, no fabricated
  references", and parameters have no `citation` field yet.
