# Valoris

> **SIMULATION MODE — NOT FOR OPERATIONAL USE**

Valoris is a **research prototype** for firefighter safety monitoring. It ingests
simulated sensor data during an incident, maintains a live picture of each
firefighter's physiological state, and produces a **personalised** risk score
calibrated to that individual's age, fitness and medical conditions.

The core idea: two firefighters with identical vital signs in identical
conditions should produce *different* risk scores, because one is 28 and fit and
the other is 54 with asthma and hypertension. Generic thresholds are what already
exists, and what fails people.

## What Valoris does not do: model fire behaviour

Fire spread modelling is solved. FARSITE, Phoenix RapidFire and satellite
perimeter products exist, and fire agencies already use them. Competing there
would be a losing argument.

**Valoris consumes a fire prediction and works out what it means for each
individual firefighter.** That translation is the product.

The `FireFrontProvider` interface has three implementations:

- **`GeometricSpreadProvider`** — a wind-driven ellipse for the demo. A drawing,
  not a model. Confidence is capped at `low` and it reports
  `isFireBehaviourPrediction: false`, permanently.
- **`FarsiteAdapter`** — an interface stub for a future pilot. Always refuses.
  No speculative client is shipped.
- **`HistoricalPerimeterProvider`** — reads real observed perimeters from a
  GeoJSON file you supply (e.g. an export from
  [NIFC Open Data](https://data-nifc.opendata.arcgis.com/)). No data is bundled
  and no remote service is called.

The risk engine never learns which provider is active. It receives a distance in
metres and a confidence, and nothing more. A test enforces that boundary.

The **commander view at `/` does not use the geometric ellipse at all.** It draws
the real observed NIFC perimeter and grows it along the published acreage curve,
which is closer to honest but still not a prediction: every perimeter before the
fire reaches full size is interpolated, and the real fire did not grow
self-similarly. The ellipse remains only in the tick-based `/live` view.

## Current state

Built:

- `lib/risk/` — the deterministic risk engine, pure TypeScript with no React, no
  database and no framework imports
- `lib/physiology/` — reduced ISO 7933 heat balance, Karvonen heart-rate reserve
  with a PPE penalty, and a Kalman core-temperature estimator driven by heart
  rate
- `lib/sensors/` — the EPA PurpleAir PM2.5 correction and a vendor-agnostic CGM
  adapter (Dexcom **sandbox** only)
- `config/` — 86 risk parameters and 64 physiology parameters, each named,
  bounded and provenance-tagged
- `lib/fire/` — the fire front abstraction and its three providers
- `lib/sim/` — the Palisades scene: real perimeter geometry, and a deterministic
  evaluator that is a pure function of (time, crew positions)
- `prisma/schema.prisma` — ten tables, UUID keys, UTC timestamps, units in field
  names, `Observation` and `AuditEvent` append-only **enforced by SQLite
  triggers**
- Twenty API routes under `/app/api`, every body Zod-validated
- 274 tests, including 27 fast-check properties

Two front ends:

- **`/`** — the commander view. Scrub the real Palisades timeline, drag crew
  around the map, and read three personalised risk zones per firefighter.
- **`/live`** — the tick-based simulator. Slower and narrower, but it is the only
  path that pushes observations through `POST /observations` with validation,
  provenance and the audit log.

Not built: recommendation *generation*, post-incident report. The
recommendation action routes exist and enforce the reason rule; nothing creates
recommendations yet.

## Setup

```bash
npm install
```

```bash
npm run migrate
```

```bash
npm run seed
```

> **Use `npm run migrate`, not `npx prisma migrate dev` directly.** Prisma adds a
> column to a SQLite table by rebuilding it, which drops that table's triggers —
> including the append-only guards on `Observation` and `AuditEvent`. `npm run
> migrate` re-applies and proves them afterwards. `npm run seed` also restores
> them, so the documented startup below is self-healing either way, and
> `npm run verify:m2` fails loudly if any guard is absent.
> See [docs/KNOWN_LIMITATIONS.md](docs/KNOWN_LIMITATIONS.md) item 22.

```bash
npm run dev
```

## API

```
POST   /api/incidents
GET    /api/incidents/[id]
POST   /api/incidents/[id]/start
POST   /api/incidents/[id]/stop
POST   /api/incidents/[id]/observations
GET    /api/incidents/[id]/snapshot
GET    /api/incidents/[id]/risks
GET    /api/incidents/[id]/stream            ← Server-Sent Events
GET    /api/incidents/[id]/recommendations
POST   /api/recommendations/[id]/acknowledge
POST   /api/recommendations/[id]/accept
POST   /api/recommendations/[id]/reject       ← reason required, 400 if empty
POST   /api/recommendations/[id]/override     ← reason required, 400 if empty
GET    /api/audit
GET    /api/health

POST   /api/demo/scene                        ← the commander view: (time, crew positions) → picture
GET    /api/demo/contours                     ← per-firefighter band boundaries
GET    /api/demo/compare
GET    /api/demo/burn-perimeter
GET    /api/sim   POST /api/sim               ← the tick-based /live simulator
```

`POST /api/demo/scene` is stateless on purpose. The commander scrubs a timeline
and drags crew markers, so every request carries the time and the positions and
the same request always returns the same answer. Nothing accumulates
server-side, which is what makes scrubbing backwards valid.

The reason requirement on reject and override is enforced three times: by Zod on
the request body, by an assertion in the shared action handler, and by a SQLite
trigger on insert. A UI bug, a direct API call and a direct Prisma call all fail.

## Data provenance — Tier A / B / C

Every observation records where each part of it came from, per domain, and the
tiers are never collapsed into one:

| Tier | Meaning | In use today |
|---|---|---|
| **A** | Real measured environmental data (NIFC, Open-Meteo, PurpleAir, FIRMS) | Only when an operator supplies a real perimeter GeoJSON |
| **B** | Real wearable data from **non-firefighter** subjects (WESAD, PAMAP2) | **Not in use.** No noise model has been built, so nothing claims it |
| **C** | Synthetic, model-driven output | Everything else: environment, crew positions, vitals, physiology |

`GET /api/incidents/[id]/snapshot` returns the data provenance strip:

```
Environment      SIMULATED   C · SIMULATED   valoris_simulated_atmosphere
Fire front       SIMULATED   C · SIMULATED   valoris_geometric_spread_placeholder
Crew positions   SIMULATED   C · SIMULATED   valoris_simulated_deployment_position
Crew vitals      SIMULATED   C · SIMULATED   valoris_simulated_wearable
Physiology       SIMULATED   C · SIMULATED   valoris_physiology_models
```

A Tier C record marked `isSimulated: false` — synthetic data presented as real —
throws at construction. So does a Tier A record marked simulated.

### What is real in the Palisades demo

The commander view lists this on screen under **"What here is real?"**, so the
synthetic parts are disclosed rather than discovered:

| | Component | Detail |
|---|---|---|
| **REAL** | Risk engine | Production `assessRisk` and `derivePhysiology`, unmodified |
| **REAL** | Fire outline | NIFC WFIGS observed perimeter, IR image interpretation, 23,448 acres |
| **REAL** | Timeline endpoints | Discovery and incident close read from the interagency record, not typed in |
| **UNVERIFIED** | Growth timing | Intermediate acreages from contemporaneous reporting, not the CAL FIRE archive |
| **UNVERIFIED** | Polygon date | Stamped 8 Jan but revised 21 Jan and measuring the *final* size — so it is treated as a final footprint, never a dated snapshot |
| **SYNTHETIC** | Intermediate perimeters | Area-scaled interpolation. The real fire did not grow self-similarly. **Not a fire behaviour prediction** |
| **SYNTHETIC** | Smoke and heat | Exponential falloff with hand-chosen scale lengths. No wind, terrain or plume model |
| **SYNTHETIC** | Crew positions | Invented. Real deployment positions are not public and are never guessed |

There is no dated perimeter progression for this fire. That was verified against
the live services rather than assumed — `WFIGS_Interagency_Perimeters`,
`..._YearToDate` and `WFIGS_Daily_Perimeters_Public` each return exactly one
Palisades 2025 feature. See
[the data README](data/historical/palisades-2025/README.md).

> **One claim to make carefully.** The personalised contour distances come from
> the real engine, but their *absolute metres* also depend on the synthetic
> atmosphere model, whose falloff constants have no empirical basis. The
> **ordering** between firefighters is meaningful; the **metres** are
> illustrative. Say "the engine puts BRAVO-2 four times further out than
> ALPHA-1", not "BRAVO-2 needs 950 metres".

## Verify it yourself

```bash
npm run verify:m1
```

```bash
npm run verify:m2
```

`verify:m1` runs the engine standalone. `verify:m2` drives the live HTTP API —
start `npm run dev` first.

## Try the engine on its own

```bash
npm run risk:demo
```

This runs `assessRisk` against six deliberately varied profiles given **identical**
vitals, environment and position, and prints the resulting spread. It also shows
what happens when a heart-rate sensor stops reporting.

## Checks

```bash
npm run lint && npm run typecheck && npm test
```

## Drones

Two kinds, doing two different jobs. Only one of them touches the risk score.

**Reconnaissance drones are a sensor platform.** Three are tasked over the crew,
one per sector, grouped by bearing — not parked at a fixed standoff from the
flame front. A firefighter inside a recon footprint
has *current* air data; one outside does not, so their environmental channels age
past the 60-second stale threshold and the existing staleness rules drop their
confidence. No new scoring path and no special case in the engine — the drone
earns its place through machinery that was already there.

It also answers a question the demo previously dodged: where was a live CO and
PM2.5 reading at one firefighter's exact position supposed to be coming from?

Coverage is finite, so it can be lost: drag a firefighter far enough out of
their sector and their air data goes stale. Because a drone sits at its sector's
centroid, pulling one crew member away degrades coverage for the other in that
sector too — splitting a sector costs you both.

The footprints are **not drawn** on the map. Three overlapping 2.2 km rings in a
fourth colour fought with the risk bands the map exists to show. Coverage is
reported per crew member instead, by the `RECON` / `NO RECON` chip on their row.
Flip `SHOW_RECON_FOOTPRINTS` in `CommanderView.tsx` to draw them.

The effect is visible immediately. At 9 Jan, five of six crew sit under coverage
and read `medium` confidence; CHARLIE-2 sits outside it, drops to `low`, and the
band becomes **`UNKNOWN` rather than `SAFE`** — the "low confidence can never
produce SAFE" rule, triggered by a gap in drone coverage rather than by a broken
sensor.

**Casualty extraction is flown by a helicopter, not a drone.** An earlier version
had a drone carry the firefighter out. A drone capable of lifting a person in PPE
is enormous and nobody fields one over a fireground; rotary-wing hoist extraction
is routine capability today. The claim did not survive contact with the domain,
so it was replaced rather than defended.

Three legs on the wall clock: **INBOUND** from the helibase, **HOIST** holding
over the casualty, then **LIFTING** them out. The destination is derived from
that firefighter's own safe contour, so it differs per person, and the lift stops
the moment the engine reports SAFE rather than running a fixed distance.

**Support drones keep the job drones are good at — sensing.** One joins at the
hoist and holds over the extraction, and its footprint is submitted to the scene
as a coverage unit. Without it a casualty drifts out of the recon pattern
mid-extraction and their confidence collapses exactly when it matters. Measured
with a firefighter stranded outside coverage: `UNKNOWN` / low confidence without
the support drone, `SAFE` / medium with it — and the crew member still out of
sector correctly stays `UNKNOWN`, so it covers who it is over and nobody else.

Evacuation is **requested by the commander** and never launched automatically.

They are dispatched **by the commander**, from a button on that crew member's
row, and never automatically. Valoris does not withdraw anyone and does not
launch anything on its own; it can show that a crew member is falling back and
make dispatch one click away. That is the limit, and it is rule 9 in the list
below.

> **No drone integration exists.** No airframe, autopilot, vendor or datalink is
> modelled. Both kinds are Tier C and labelled so in the provenance panel.

## Projection

Each crew row carries a time-to-threshold: *"DANGER in 2 h 15 if they hold"*.

The scene is a pure function of time, so a future moment costs no more to
evaluate than the present one — this is the thing the scrubbable design buys
that a live tick loop cannot. The projection advances **only the fire**, holding
position, derived physiology and work cycle at today's values, so it answers
"the fire keeps growing and this person does not move". It is not a prediction
of their physiology hours from now.

The scrub range ends on **12 January, when the fire reached its full observed
extent** — not at containment on 31 January. Running it to containment left four
fifths of the slider showing an identical static picture. Containment is still in
the incident record and still reported; it is just not the end of the scrub.

Twelve-hour horizon, fifteen-minute resolution. **No projection is offered from
an `UNKNOWN` state** — if the engine does not currently know where someone
stands, projecting forward would dress a gap up as foresight.

## Basemaps

One button cycles **DARK → TERRAIN → SATELLITE → OFF**.

Terrain matters for this incident specifically. The Palisades fire ran through
the Santa Monica Mountains, and slope is a large part of why it went where it
did — seeing a crew's standoff against the ridges says more than seeing it
against a flat dark background.

| Mode | Source | Key required |
|---|---|---|
| Dark | CARTO `dark_all` | no |
| Terrain | Esri `World_Topo_Map` | no |
| Satellite | Esri `World_Imagery` | no |

All three are attributed in the map's attribution control. Raster opacity is held
below 1 on the bright basemaps so the risk bands, painted over them at 0.13–0.32,
stay readable.

`OFF` is a first-class option, not a fallback: the map boots with **no external
source at all** and the fire, zones, crew and drones are drawn from our own data.
A tile server being unreachable cannot take the operational picture down.

## Data inputs

Four input groups reach `assessRisk`, defined in
[`lib/risk/types.ts`](lib/risk/types.ts).

### Health profile — static, one per firefighter

| Field | Type | What it drives |
|---|---|---|
| `age` | years | Maximum heart rate, and therefore every HR threshold |
| `fitness` | low / moderate / high | Profile vulnerability subscore |
| `restingHrBpm` | bpm | Personal baseline, not a population one |
| `spo2BaselinePct` | % | SpO2 is scored as *deviation from this*, not absolute |
| `conditions[]` | strings | Counted — see the caveat below |
| `respiratoryRisk` | none / mild / moderate / high | Shifts the SpO2 alert band earlier |
| `heatTolerance` | low / avg / high | Shifts core-temperature and ambient limits |
| `prevShiftHours` | hours | Fatigue carried in before the shift starts |
| `cumulativeCoExposureIndex` | 0–1 | Tightens CO **and** PM2.5 limits |
| `cumulativeHeatExposureIndex` | 0–1 | Tightens the ambient heat limit |
| `glucoseMonitored` | bool | Gates glucose scoring entirely |

`glucoseMonitored` matters more than it looks. Without it, an absent CGM reading
would count as a missing input for the whole crew and score everyone at worst
case for a channel most of them do not wear.

### Vitals — wearable

`hrBpm`, `spo2Pct`, `coreTempC`, `respRatePerMin`, `fatiguePct`, `hydrationPct`,
`fallDetected`, `glucoseMmolL`.

Three of these carry conditions:

- **`coreTempC` is always estimated, never measured.** Nothing in Valoris
  measures core temperature. Declaring it estimated caps confidence below `high`.
- **`glucoseMmolL` is mmol/L only**, never mg/dL, and its timestamp must be the
  *effective sample time* — when the blood glucose it represents actually
  occurred — not when the reading arrived.
- **`recentSpo2Pct[]`** is supplied by the caller because `assessRisk` is
  stateless and the SpO2 override is defined as "confirmed across N consecutive
  readings". Too few readings and the engine cannot confirm, so it fails safe: a
  single breaching reading fires the override.

### Environment

`ambientTempC`, `humidityPct`, `coPpm`, `pm25UgM3`, `windSpeedMs`, `windDirDeg`.

### Position and equipment

`lat`, `lng`, `distanceToFireFrontM`, `distanceToSafeZoneM`,
`escapeRouteStatus`, `scbaPressurePct`, `scbaOnAir`, `timeOnTaskMin`,
`manualMaydayActive`.

### The input that is easy to miss: freshness

**Every channel carries a `lastUpdatedMs` timestamp, and freshness is a
first-class input rather than metadata.** A frozen GPS or a dead SCBA sensor
keeps reporting a perfectly plausible number indefinitely; tracking the age of
each channel is what stops a stale reading from contributing to a confident
score.

Omitting `Position.lastUpdatedMs` is deliberately *unsafe*: with no map, no
channel's age can be established, so every position channel is treated as
missing. Forgetting to report freshness is meant to be loud, not silent.

## How the risk profile is built

Six stages. Every number below is a named, bounded parameter in
[`config/risk-default.json`](config/risk-default.json) — 86 of them — and none is
hard-coded in the engine.

### 1. Personalise the thresholds

Before anything is scored, the thresholds are recomputed *for this person*. This
is where the differentiation originates, not in a post-hoc adjustment:

- `hrMax = constant − age`, and every heart-rate threshold is a fraction of it
- `respiratoryRisk` shifts the SpO2 alert band earlier, by level
- `heatTolerance` shifts the core-temperature and ambient bands
- `cumulativeCoExposureIndex` **multiplicatively tightens** the CO and PM2.5
  limits (up to 30%)
- `cumulativeHeatExposureIndex` tightens the ambient limit (up to 5 °C)
- `prevShiftHours` adds fatigue carry-over at 1.5% per hour

Two firefighters with identical sensor readings are therefore measured against
different rulers. That is the whole product.

### 2. Gate every channel on freshness

Fresh (< 60 s) is usable. Stale (60–120 s) is usable but drops confidence.
Missing, or older than 120 s, is **scored at worst case** — never skipped, never
treated as absent-therefore-fine. Glucose gets its own slower clock: stale at
7 minutes, missing at 15, because a CGM does not sample every second.

### 3. Four subscores

| Subscore | Weight | Built from |
|---|---|---|
| **Physiological** | 0.40 | HR 0.30, SpO2 0.30, core temp 0.20, fatigue 0.12, time on task 0.08, glucose 0.25 |
| **Environmental** | 0.30 | CO 0.40, heat 0.35, PM2.5 0.25 — heat is humidity-adjusted, and the whole subscore is gated by SCBA on-air status |
| **Proximity** | 0.20 | Fire distance 0.40, escape route 0.35, SCBA pressure 0.25 |
| **Profile vulnerability** | 0.10 | Fitness, previous shift hours, condition count, cumulative exposure |

The physiological sub-weights sum past 1.0 on purpose. It is a **weight-normalised
mean**, so channels that do not apply — glucose for an unmonitored firefighter —
drop out and the remaining weights renormalise. Glucose may only ever *raise* the
physiological subscore, never lower it, so wearing a CGM cannot make you look
safer than not wearing one.

### 4. Composite to a band

| Band | Composite score |
|---|---|
| `SAFE` | ≤ 25 |
| `CAUTION` | ≤ 50 |
| `HIGH` | ≤ 75 |
| `CRITICAL` | > 75 |

### 5. Hard overrides bypass all of it

Any single one of these forces `CRITICAL` regardless of the composite, the band
cut-offs, or confidence:

| Override | Threshold |
|---|---|
| SpO2 | < 88%, confirmed across 3 consecutive readings |
| Core temperature | ≥ 39.5 °C |
| Heart rate | ≥ 97% of age-adjusted maximum |
| SCBA pressure | ≤ 20% |
| Escape route blocked | within 150 m of the fire front |
| Glucose | < 3.5 mmol/L (monitored firefighters only) |

The 39.5 °C core-temperature limit is **stricter** than the 40 °C figure often
cited in the literature. That is a deliberate open question for clinical review,
not an oversight — see [docs/CLINICAL_ASSUMPTIONS.md](docs/CLINICAL_ASSUMPTIONS.md).

### 6. Missing data cannot hide danger

The final band is `maxBand(compositeBand, "UNKNOWN")` — the **more severe of the
two wins**. A dead sensor can never produce `SAFE`. Confidence is reported
separately from the band, so "we do not know" is never presented as "you are
fine".

### Two caveats worth knowing up front

**Conditions are counted, not graded.** Four mild conditions score the same as
one severe one, at 25 points each. Known limitation 15.

**An open defect:** deleting a *stale* channel can raise confidence from `low` to
`medium`, because a present-but-stale reading counts toward the stale-input tally
while an absent one escapes it. It fails the existing property test
intermittently. Documented as item 8a in
[docs/KNOWN_LIMITATIONS.md](docs/KNOWN_LIMITATIONS.md) with a deterministic
reproduction. Unfixed: `lib/risk/` is frozen for the demo build.

## Safety rules the engine enforces

1. Missing or stale data is never safe. Absent inputs are scored as worst case
   and the band can never read `SAFE`.
2. Low confidence can never produce `SAFE`. It produces `UNKNOWN`.
3. Hard overrides are unconditional — they bypass the composite score, the band
   cut-offs and confidence entirely.
4. No machine learning. Deterministic and explainable. Same input plus same
   config produces byte-identical output.
5. No LLM decides safety.
6. No magic numbers. Every threshold is named, bounded, versioned and editable.
7. Every threshold defaults to `illustrative` / `unreviewed`.
8. No invented vendor integrations.
9. The commander decides. Valoris never withdraws anyone.

## Known limitations

Read [docs/KNOWN_LIMITATIONS.md](docs/KNOWN_LIMITATIONS.md) before trusting any
output. The important ones: estimated core temperature is not measured, pulse
oximetry bias is not corrected, the engine is stateless, and a band that falls at
the moment a sensor drops out is a red flag rather than an improvement.

## Safety disclaimer

Valoris is a prototype for research and demonstration. It must not be used to
make decisions about a real person in a real incident. It has not been validated
against clinical or operational outcomes, and no part of it has been reviewed by
a clinician.
