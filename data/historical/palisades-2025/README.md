# Palisades Fire 2025 — real burn perimeter

**Tier A — real environmental data.**

## Source

NIFC / WFIGS Interagency Perimeters, via the ArcGIS FeatureServer:

```
https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Interagency_Perimeters/FeatureServer/0/query
  where=poly_IncidentName='Palisades' AND poly_GISAcres>20000
  returnGeometry=true  outSR=4326  f=geojson
```

The query is the one used by
[charleneleong-ai/smart-city-foundation-model](https://github.com/charleneleong-ai/smart-city-foundation-model)
(`apps/eval_fire.py`), whose Palisades fire-spread backtest walks a cellular
automaton front over this same perimeter.

| | |
|---|---|
| Retrieved | 2026-08-14 |
| File | `perimeters.geojson`, 377 KB |
| Geometry | MultiPolygon, WGS84 (EPSG:4326) |
| Incident | PALISADES, January 2025, approximately 23,448 acres |
| Licence | Public domain (US federal interagency data) |
| Transformation | None. Stored exactly as returned. |

## Incident record

`incident-metadata.json` is the unmodified attribute response for the same
feature, retrieved 2026-08-15. The demo timeline reads its endpoints out of that
file rather than hard-coding them, so they cannot drift from the source.

| Field | Value |
|---|---|
| `attr_UniqueFireIdentifier` | 2025-CALFD-000738 |
| `attr_FireDiscoveryDateTime` | 2025-01-07T18:30:00Z |
| `attr_ICS209RptForTimePeriodTo` | 2025-02-01T01:30:00Z |
| `poly_GISAcres` | 23,448 (autocalc 23,448.8) |
| `poly_MapMethod` | IR Image Interpretation |
| `poly_Source` | 2025 NIFS |
| `attr_PrimaryFuelModel` | Chaparral (6 feet) |
| `attr_PercentContained` | 100 |

### The polygon's date cannot be read as a capture time

`poly_PolygonDateTime` is **2025-01-08T14:31:44Z**, but `poly_DateCurrent` is
**2025-01-21T23:43:48Z** and the geometry measures the *final* 23,448 acres. The
fire was not 23,448 acres on the morning of 8 January. The record was evidently
revised long after that first infrared pass while keeping the original stamp.

**Consequence:** the polygon is treated as a final footprint and never as a dated
snapshot. Nothing in the demo claims the fire had this shape on 8 January.

## What this is and is not

**Is:** the real, final observed burn perimeter of the January 2025 Palisades
fire, as recorded by the interagency perimeter service.

**Is not:** a time series. This is the *final* footprint, not a sequence of
hourly fronts, so it cannot show the fire growing.

## Known gaps

- **No timestamped intermediate perimeters exist for this fire.** Verified
  2026-08-15 against the live services rather than assumed:
  `WFIGS_Interagency_Perimeters`, `WFIGS_Interagency_Perimeters_YearToDate` and
  `WFIGS_Daily_Perimeters_Public` were each queried without the `>20000 acres`
  filter, in case that filter had been hiding earlier, smaller perimeters. It
  had not — all three return exactly one Palisades 2025 feature, the 23,448-acre
  final footprint. A genuine progression would need timestamped VIIRS/MODIS
  active-fire detections from NASA FIRMS, which requires an API key.

  Because no progression is available, the demo interpolates: the observed
  outline is area-scaled along the published acreage curve, so intermediate
  shapes are **synthetic** and are labelled as such in the app.
- **The intermediate acreages are unverified.** Only the first and last points
  of the growth curve come from the incident record; everything between is
  transcribed from contemporaneous public reporting and shapes the curve only.
- **Real crew positions and real firefighter outcomes from this incident are not
  public and are never invented.** Every crew marker in this demo is a simulated
  deployment position and is labelled Tier C.
- The ignition point used (34.0725, −118.5425) is the one used by the reference
  repository above; it is approximate.

## Honesty rule

The perimeter is real. Every intermediate perimeter the timeline draws is
interpolated and reports itself as "not a fire behaviour prediction". The crews,
their positions and all their physiology are simulated. The commander view lists
this breakdown on screen under "What here is real?", so the synthetic parts are
disclosed rather than discovered.

One claim deserves particular care. The personalised contour distances are
produced by the real risk engine, but the *absolute metres* also depend on the
synthetic atmosphere model in `lib/sim/scene.ts`, whose exponential falloff
constants have no empirical basis. **The ordering between firefighters is
meaningful; the metres are illustrative.** Say "the engine puts BRAVO-2 four
times further out than ALPHA-1", not "BRAVO-2 needs 950 metres".
