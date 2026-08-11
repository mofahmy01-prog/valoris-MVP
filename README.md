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

## What this is not

Not a medical device. Not clinically validated. Not an autonomous system. Not for
operational use. No external body — including the ADA or the British Thoracic
Society — has reviewed, endorsed or validated this model. Published guidance may
inform an individual threshold; it does not validate Valoris.

Every threshold ships as `illustrative` / `unreviewed` and stays that way until an
occupational physician signs off. See [docs/CLINICAL_ASSUMPTIONS.md](docs/CLINICAL_ASSUMPTIONS.md).

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

## Current state — Milestone 2 of 6

Built:

- `lib/risk/` — the deterministic risk engine, pure TypeScript with no React, no
  database and no framework imports
- `config/risk-default.json` — 78 named, bounded, provenance-tagged parameters
- `lib/fire/` — the fire front abstraction and its three providers
- `prisma/schema.prisma` — ten tables, UUID keys, UTC timestamps, units in field
  names, `Observation` and `AuditEvent` append-only **enforced by SQLite
  triggers**
- Fifteen API routes under `/app/api`, every body Zod-validated
- 64 tests, including six fast-check properties

Not built: simulator, map, commander dashboard, forecasting, recommendation
generation, post-incident report. Those are Milestones 3–6. The recommendation
action routes exist and enforce the reason rule; nothing creates recommendations
yet.

## Setup

```bash
npm install
```

```bash
npx prisma migrate dev
```

```bash
npm run seed
```

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
```

The reason requirement on reject and override is enforced three times: by Zod on
the request body, by an assertion in the shared action handler, and by a SQLite
trigger on insert. A UI bug, a direct API call and a direct Prisma call all fail.

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

## How the score is built

| Component | Weight | Inputs |
|---|---|---|
| Physiological | 40% | HR as % of age-adjusted max, SpO2 deviation from personal baseline, estimated core temp, fatigue, time on task |
| Environmental | 30% | CO, PM2.5, humidity-adjusted ambient heat, gated by SCBA on-air status |
| Proximity | 20% | Distance to fire front, escape route status, SCBA pressure |
| Profile vulnerability | 10% | Respiratory risk, heat tolerance, fitness, previous shift hours, condition count, cumulative exposure |

Personalisation runs through all four: age sets maximum heart rate, respiratory
risk makes SpO2 alerts fire earlier, heat tolerance shifts temperature limits,
previous shift hours raise the fatigue baseline, and cumulative exposure tightens
environmental thresholds.

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
