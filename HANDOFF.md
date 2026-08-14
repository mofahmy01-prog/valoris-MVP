# Valoris — handoff

Repo: `github.com/mofahmy01-prog/valoris-MVP` (private)
Local: `C:\Users\Mofah\valoris`

**SIMULATION MODE — NOT FOR OPERATIONAL USE.** Research prototype. Not a medical
device, not clinically validated. Every threshold is `illustrative` /
`unreviewed`.

---

## 1. Branches

| Branch | Head | What it is |
|---|---|---|
| `demo-saturday` | `10e0c70` | **Active.** Engine + hackathon UI + simulator. Work here. |
| `build/milestones-1-to-3e` | `48d6ee4` | Engine only, no UI. The clean library line. |
| `backup/m1-to-3e-2026-08-14` | `48d6ee4` | Frozen snapshot. Do not touch. |
| `experiment/speedrun` | `48d6ee4` | Scratch, unused. |
| `main` (GitHub only) | `b7d3797` | README stub, unrelated history. Ignore. |

All pushed to `origin`. `demo-saturday` = `build/…` + 3 UI commits.

## 2. Run it

```bash
npm install
npm run migrate      # prisma migrate dev + re-applies DB guards
npm run seed         # 6 firefighter profiles + restores DB guards
npm run dev          # http://localhost:3000
```

Then in the UI: **▶ PLAY**. Or drive the simulator directly:
`POST /api/sim {"action":"start"}`.

**Use `npm run migrate`, never `npx prisma migrate dev` alone** — see §7.

Scripts: `lint`, `typecheck`, `test`, `seed`, `migrate`, `db:guards`,
`sweep`, `risk:demo`, `verify:m1`, `verify:m2`, `verify:m3b`, `verify:m3d`,
`verify:repro`.

## 3. Architecture — layer by layer

Dependencies point **downward only**. Tests enforce it; do not add a back-edge.

```
app/                     UI + HTTP routes
  └── lib/incident/      composition (the ONLY place models meet)
        ├── lib/risk/          scoring engine      ─┐
        ├── lib/physiology/    Tier C models        ├── none of these
        ├── lib/fire/          fire front providers │   import each other
        ├── lib/sensors/       PurpleAir + CGM      │
        └── lib/provenance/    data tiers          ─┘
              └── lib/params/  shared config machinery
```

### `lib/risk/` — the scoring engine
| File | Purpose |
|---|---|
| `engine.ts` | `assessRisk()`. Composite score, bands, hard overrides, staleness, confidence. |
| `types.ts` | `HealthProfile`, `Vitals`, `Environment`, `Position`, `RiskAssessment`. |
| `config.ts` | 90 named parameter names + loader. |
| `bands.ts` | Band severity ordering, confidence degradation. |
| `default-config.ts` | Loads `config/risk-default.json` + shared config. |

Pure. No React, no Prisma, no framework imports. No `Date.now()`, no
`Math.random()`. Same input + same config = byte-identical output.

### `lib/physiology/` — Tier C models
`cardiac.ts` (Karvonen + PPE penalty) · `heat-strain.ts` (reduced ISO 7933 PHS)
· `core-temp-kalman.ts` (sequential Kalman from HR) · `fatigue.ts` ·
`toxic-exposure.ts` (COHb + PM2.5 dose, SCBA-gated).

### `lib/fire/` — fire front, three providers behind one interface
`geometric-spread-provider.ts` (placeholder ellipse, demo) ·
`historical-perimeter-provider.ts` (reads NIFC GeoJSON) ·
`farsite-adapter.ts` (stub, always refuses). **Valoris does not model fire
behaviour** — it consumes a front and translates it into individual risk.

### `lib/sensors/`
`purpleair-correction.ts` — EPA US-wide correction extended for wildfire smoke,
three regimes, cf_1 channel only, quality gates.
`cgm/` — vendor-agnostic `CgmAdapter`, Dexcom **sandbox** adapter, simulated
adapter, Abbott stub, interstitial lag correction.

### `lib/incident/` — composition
`physiology-pipeline.ts` — HR → Karvonen → metabolic rate → heat balance → core
temp + fatigue + toxic. Produces what the engine consumes.
`snapshot.ts` — builds the live incident picture. `mapping.ts` — DB rows → engine types.

### `lib/sim/` — demo simulator (presentation only)
`simulator.ts` — deterministic per-tick state. `runtime.ts` — tick loop, POSTs
through the **real** `/observations` route.

### `app/demo/` — the UI
`DemoClient.tsx` (shell, polling) · `IncidentMap.tsx` (MapLibre) ·
`CrewPanel.tsx` · `ComparePanel.tsx` · `DetailPanel.tsx` · `InputsPanel.tsx` ·
`theme.ts` (colours, band glyphs, `presentation()`).
`app/page.tsx` renders `DemoClient`. `app/assumptions/page.tsx` = model
assumptions table.

## 4. Data

`prisma/schema.prisma` — 10 tables. `Observation` and `AuditEvent` are
**append-only, enforced by SQLite triggers**.

`config/*.json` — every model parameter, named, bounded, provenance-tagged:
`risk-default.json` (90) · `physiology-default.json` (62) ·
`purpleair-default.json` (14) · `risk-diabetes.json` (18) ·
`shared-default.json` (1, owned jointly).

`data/historical/palisades-2025/perimeters.geojson` — **real NIFC burn
perimeter**, Jan 2025, public domain. See the README beside it.

## 5. Invariants — do not break these

1. **Missing data is never safe.** Absent inputs score at worst case; the band
   can never read `SAFE`. Absent HR/SpO₂/core temp (and glucose, for a monitored
   firefighter) forces confidence `low`.
2. **Hard overrides are unconditional.** They bypass the composite, the band
   cut-offs and confidence.
3. **Severity beats data loss in the UI.** A `HIGH`/`CRITICAL` card keeps its
   colour and gains a `? DATA MISSING` badge. Only a non-severe card greys out.
   Greying a critical firefighter would hide real danger behind a sensor message.
4. **Determinism.** No `Date.now()` or `Math.random()` in any model. Clock and
   config are injected.
5. **No parameter may be `validated`.** `literature_derived` requires a
   `citation`; the loader rejects it otherwise.
6. **Never blur data tiers.** Provenance is per-domain and summarised as e.g.
   `A+C`, never collapsed. Tier C marked real throws at construction.
7. **Simulator uses the real ingestion path.** No shortcuts around
   `POST /observations`.
8. **Never claim real-time Dexcom or an integration with Dexcom** — it is their
   sandbox. Tests assert this.

## 6. Tests

`npm test` → **274 passing, 8 files.** Vitest + fast-check. Property tests cover
score bounds, override ⇒ CRITICAL, low confidence ⇒ never SAFE, determinism, and
"removing an input is never rewarded".

Live harnesses (need `npm run dev` running) — each does a **preflight** that
refuses to run against a stale server:
`verify:m1` (engine standalone) · `verify:m2` (API + DB guards) ·
`verify:m3b` (physiology pipeline) · `verify:m3d` (PurpleAir) ·
`verify:repro` (profile snapshot immutability).

## 7. Trap that bit twice

**Prisma rebuilds SQLite tables to add a column, which silently drops their
triggers** — including the `Observation` append-only guards. Two migrations
destroyed them before anyone noticed.

Mitigations: `npm run migrate` re-applies guards; `npm run seed` re-applies them
and refuses to seed if they do not enforce; `verify:m2` checks them first,
read-only, and fails loudly. `lib/db/guards.ts` is the single definition.

Second trap: a stale `npm run dev` holding port 3000 makes a new server move to
3001, so harnesses verify old code. `scripts/preflight.ts` now catches it.

## 8. Docs — read before changing thresholds

| File | Contents |
|---|---|
| `docs/CLINICAL_ASSUMPTIONS.md` | 31 numbered assumptions, blocking items in priority order, reference list, sign-off checklist. **Start here.** |
| `docs/KNOWN_LIMITATIONS.md` | 34 honest limitations. |
| `docs/DATA_PROVENANCE.md` | Two blocking verification items, outreach log. |
| `docs/PILOT_READINESS_CHECKLIST.md` | Clinical + HIPAA/BAA gates. |
| `docs/ROADMAP.md` | Outcome capture, ML readiness, 3a–3i sequence. |

### Blocking clinical items, in order
1. **No CO hard override exists.** CO only feeds a weighted subscore that can be
   outvoted. Fast onset, steep dose-response — wrong mechanism. Needs a decision
   on ppm, instantaneous vs COHb, and SCBA gating.
2. **No false-alarm budget.** Nothing can be calibrated until someone states it.
3. **Kalman coefficients are an unverified transcription** (Buller et al. 2013)
   and drive every core temperature. Warning shown on screen.
4. **Core temp override 39.5 °C vs 40 °C** — two documents disagree; stricter
   implemented.
5. **PurpleAir coefficients unverified** (Barkjohn et al. 2022).

## 9. State of the demo

**Works:** simulator through the real ingestion path; MapLibre map over Pacific
Palisades with the real NIFC perimeter (dashed amber, Tier A) and the simulated
front (solid orange, Tier C); crew markers by band; live inputs strip; crew
cards; compare view with severity slider; detail panel; wind shift; kill sensor.

**Not built:** recommendations engine, alert queue, audit UI, post-incident
report, forecasting (Milestone 5), Tier B noise models, Palisades replay mode.
Cut deliberately by `DEMO_ONE_DAY.md`.

**Next most valuable:** the alert queue — recommendation generation plus
commander acknowledge/accept/reject/override. The API routes and the DB-level
reason enforcement already exist (`app/api/recommendations/[id]/*`); nothing
generates recommendations yet.

**Known rough edges:** basemap needs network (tiles from CARTO; overlays still
render without it); markers snap between ticks; Dexcom sandbox adapter is not
called by the simulator (BRAVO-1's glucose is model-driven through the real lag
correction).

## 10. Two things that must not be misrepresented

- **Crew positions and physiology are simulated.** Real crew positions and
  outcomes from Palisades are not public and must never be invented.
- **The fire front Valoris animates is a placeholder**, not a fire behaviour
  prediction. The burn perimeter is real; the front is not.
