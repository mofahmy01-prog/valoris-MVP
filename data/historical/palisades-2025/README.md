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

## What this is and is not

**Is:** the real, final observed burn perimeter of the January 2025 Palisades
fire, as recorded by the interagency perimeter service.

**Is not:** a time series. This is the *final* footprint, not a sequence of
hourly fronts, so it cannot show the fire growing. Valoris draws it as a fixed
reference outline and runs its own simulated front separately, labelled as such.

## Known gaps

- No timestamped intermediate perimeters, so no real progression is available.
- **Real crew positions and real firefighter outcomes from this incident are not
  public and are never invented.** Every crew marker in this demo is a simulated
  deployment position and is labelled Tier C.
- The ignition point used (34.0725, −118.5425) is the one used by the reference
  repository above; it is approximate.

## Honesty rule

The perimeter is real. The fire *front* Valoris animates is a placeholder
ellipse and reports itself as "not a fire behaviour prediction". The crews, their
positions and all their physiology are simulated. The data provenance strip
shows which is which, and the two are never blurred.
