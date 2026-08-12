# Data provenance and outreach log

**SIMULATION MODE — NOT FOR OPERATIONAL USE.**

Required by both the Data Addendum and the Sensor Integration Spec. Records what
data Valoris uses, where it came from, and every request made for data it does not
have.

**Rule: nothing is added to this log speculatively.** An empty row is honest; an
optimistic one is not.

---

## 1. Data currently in the build

| Source | Tier | Status | Notes |
|---|---|---|---|
| Operator-supplied fire perimeter GeoJSON | **A — real environmental** | Supported, no data bundled | `HistoricalPerimeterProvider` reads a file the operator downloads from [NIFC Open Data](https://data-nifc.opendata.arcgis.com/). No perimeter data is committed to this repository, and the provider refuses rather than substituting invented geometry. |
| Geometric spread placeholder | **C — synthetic** | Active, demo only | A wind-driven ellipse drawn by Valoris. Confidence hard-capped at `low`; `isFireBehaviourPrediction` hard-coded false. |
| Simulated environment, crew positions, vitals | **C — synthetic** | Active | Supplied by the caller via the observations API. No real values. |
| Physiology model output | **C — synthetic** | Active | Reduced ISO 7933 heat balance, Karvonen reserve, Kalman core temperature estimate, fatigue and toxic accumulators. |

**No Tier B data is in use.** No signal-noise model has been built, so nothing in
the system claims WESAD/PAMAP2 texture. The provenance strip states this
explicitly rather than staying silent.

## 2. Data not yet acquired

| Source | Needed for | Access route | Status |
|---|---|---|---|
| NASA FIRMS | Active fire detections | Free API key, `firms.modaps.eosdis.nasa.gov` | **Not requested** |
| NIFC / CAL FIRE FRAP perimeters (Palisades 2025) | Tier A fixtures, Palisades replay | Direct download, public domain | **Not downloaded** |
| Open-Meteo historical weather | Tier A fixtures | Free, no key | **Not requested** |
| PurpleAir | PM2.5 with EPA correction | Free API key via purpleair.com form | **Not requested.** Attribution is required and must appear in the report footer. |
| EPA AirNow | Regulatory-grade CO and PM | Free API key | **Not requested** |
| WESAD / PAMAP2 / PhysioNet | Tier B signal texture | Open download | **Not downloaded** |
| Dexcom sandbox | CGM development | Register at developer.dexcom.com, immediate and free | **Not registered** |

## 3. Firefighter physiological dataset requests

Several relevant datasets are published as *"available from the corresponding
author on reasonable request."* A physician with 25 years in firefighter
occupational health making that request is credible in a way a software founder
emailing cold is not.

If even one dataset arrives, Tier C parameters can move from `illustrative` toward
`literature_derived` against real firefighter recordings — a materially different
claim from the current position.

| # | Target | Requested by | Date requested | Response | Outcome |
|---|---|---|---|---|---|
| 1 | Core temperature and heart rate response to repeated bouts of firefighting activities (Horn, Blevins, Fernhall, Smith) | | | | |
| 2 | Heat strain in professional firefighters, simulated smoke dive (Sandsund, Aamodt, Renberg, 2024) | | | | |
| 3 | Validity of heart-rate-derived core temperature estimation during simulated firefighting tasks (2023) | | | | |
| 4 | Dynamic thermal physiological response dataset under firefighting scenarios (2026) | | | | |
| 5 | Physical and thermal strain of firefighters by wildfire suppression tactic (Rodríguez-Marroyo) | | | | |

**None contacted.** Author names are as given in the Data Addendum; full
citations have not been obtained.

## 4. Vendor and partner conversations

| # | Organisation | Purpose | Opened by | Date | Status |
|---|---|---|---|---|---|
| 1 | Dexcom | Sandbox registration | | | **Not started** |
| 2 | Dexcom | Limited Access, up to 5 real users — takes weeks | | | **Not started** |
| 3 | Dexcom | Whether real-time Partner API access is achievable | | | **Not started.** Better opened by a physician than by an engineer. |
| 4 | PurpleAir | API key | | | **Not started** |
| 5 | Cloud provider (TBD) | Business Associate Agreement scope | | | **Not started.** See `docs/PILOT_READINESS_CHECKLIST.md`. |

## 5. Verification of cited literature

Every reference in `docs/CLINICAL_ASSUMPTIONS.md` carries a verification status.
**No paper has been read by the author of this codebase.** The most urgent is
reference **[2]**, whose coefficient values are transcribed from memory and drive
every core temperature estimate in the system.

| Ref | Priority | Action needed | Done |
|---|---|---|---|
| [2] Buller et al. 2013 | **HIGH** | Confirm the seven `kalman_*` coefficient values against the paper. They are currently marked `literature_derived` with an UNVERIFIED note in every rationale. | ☐ |
| [3] Barkjohn et al. 2022 + 2024 corrigendum | HIGH, blocks 3d | Read before implementing the PM2.5 correction | ☐ |
| [1] ISO 7933 | Medium | Confirm which terms the reduced implementation omits | ☐ |
| [4] Karvonen 1957 | Low | Confirm attribution | ☐ |
| [6] WESAD / PAMAP2 | Low, blocks 3f | Obtain full citations | ☐ |
