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

## Current state — Milestone 1 of 6

Built:

- `lib/risk/` — the deterministic risk engine, as pure TypeScript with no React,
  no database and no framework imports
- `config/risk-default.json` — 78 named, bounded, provenance-tagged parameters
- `lib/risk/risk.test.ts` — property tests and unit tests
- `scripts/risk-demo.ts` — runs the engine standalone, no app required
- A minimal web page showing the model assumptions table

Not built: database, API, simulator, map, commander dashboard, forecasting,
recommendations, audit log, post-incident report. Those are Milestones 2–6.

## Setup

```bash
npm install
```

```bash
npm run dev
```

Milestones 2+ will add `npx prisma migrate dev` and `npm run seed` to that
sequence.

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
