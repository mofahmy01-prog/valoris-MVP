"use client";

/**
 * Real map. MapLibre GL over a dark raster basemap, centred on Pacific
 * Palisades — actual streets and coastline, pan and zoom.
 *
 * Basemap tiles come from CARTO's public dark style: no API key, attribution
 * required and rendered. If tiles fail to load the map degrades gracefully —
 * the dark background, the fire polygon and the crew markers all still render,
 * because those are drawn from our own data, not from the tile server.
 */

import maplibregl from "maplibre-gl";
import { useEffect, useRef, useState } from "react";

import { asBand, BAND_COLOUR, COLOURS, presentation } from "./theme";
import type { Snapshot } from "./types";

/** Real Palisades ignition point, January 2025. */
const PALISADES = { lat: 34.0725, lng: -118.5425 };

/** Safe zone / muster point, north-west of the incident. */
const SAFE_ZONE = { lat: 34.0522, lng: -118.5524, radiusM: 260 };

function circlePolygon(
  centre: { lat: number; lng: number },
  radiusM: number,
  points = 64,
): number[][] {
  const coords: number[][] = [];
  const latRad = (centre.lat * Math.PI) / 180;
  for (let i = 0; i <= points; i += 1) {
    const angle = (i / points) * Math.PI * 2;
    const dx = (radiusM * Math.cos(angle)) / (111_320 * Math.cos(latRad));
    const dy = (radiusM * Math.sin(angle)) / 110_540;
    coords.push([centre.lng + dx, centre.lat + dy]);
  }
  return coords;
}

export function IncidentMap({
  snapshot,
  selected,
  onSelect,
}: {
  snapshot: Snapshot | null;
  selected: string | null;
  onSelect: (callsign: string) => void;
}) {
  const container = useRef<HTMLDivElement | null>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const markers = useRef<Record<string, maplibregl.Marker>>({});
  /**
   * STATE, not a ref. A ref assigned inside `on("load")` never notifies React,
   * so the effect that draws the fire and the crew never re-ran once the map
   * became ready — which is exactly why no markers appeared.
   */
  const [ready, setReady] = useState(false);
  const [basemapOn, setBasemapOn] = useState(false);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  /* --- Create the map once ---------------------------------------------- */
  useEffect(() => {
    if (container.current === null || map.current !== null) return;

    const m = new maplibregl.Map({
      container: container.current,
      /*
        NO EXTERNAL SOURCES IN THE INITIAL STYLE.

        A style whose only source is a remote tile server makes the whole map
        contingent on the network: if tiles cannot be reached the style may
        never finish loading, `load` never fires, and nothing renders — not the
        fire, not the crew, none of which need the network at all.

        So the map boots self-contained and always works offline. The basemap is
        added afterwards, at runtime, and its failure cannot take the
        operational picture down with it. Toggle it with the BASEMAP button.
      */
      style: {
        version: 8,
        sources: {},
        layers: [
          {
            id: "bg",
            type: "background",
            paint: { "background-color": COLOURS.background },
          },
        ],
      },
      center: [PALISADES.lng, PALISADES.lat],
      // The real burn area is about 11 km across; the crews work a sector a few
      // hundred metres wide. This frames the working area with the burn
      // perimeter visible around it — zoom out one step to see the whole fire.
      zoom: 12.2,
      attributionControl: false,
    });

    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    m.addControl(
      new maplibregl.AttributionControl({ compact: true }),
      "bottom-right",
    );
    m.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");

    // Robust init. `load` fires once; if the style is already loaded by the
    // time we attach (Fast Refresh, a cached style, a re-mount) the event never
    // comes and the map sits there with no layers and no markers. Errors are
    // logged rather than swallowed inside the event handler.
    const initLayers = () => {
      try {
      // Safe zone
      m.addSource("safe-zone", {
        type: "geojson",
        data: {
          type: "Feature",
          properties: {},
          geometry: { type: "Polygon", coordinates: [circlePolygon(SAFE_ZONE, SAFE_ZONE.radiusM)] },
        },
      });
      m.addLayer({
        id: "safe-zone-fill",
        type: "fill",
        source: "safe-zone",
        paint: { "fill-color": BAND_COLOUR.SAFE, "fill-opacity": 0.1 },
      });
      m.addLayer({
        id: "safe-zone-line",
        type: "line",
        source: "safe-zone",
        paint: {
          "line-color": BAND_COLOUR.SAFE,
          "line-width": 2,
          "line-dasharray": [3, 2],
        },
      });

      // REAL burn perimeter — NIFC, Tier A. Drawn beneath the simulated front
      // and styled differently so the two are never mistaken for each other.
      m.addSource("burn-perimeter", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      m.addLayer({
        id: "burn-fill",
        type: "fill",
        source: "burn-perimeter",
        paint: { "fill-color": "#F0A020", "fill-opacity": 0.08 },
      });
      m.addLayer({
        id: "burn-line",
        type: "line",
        source: "burn-perimeter",
        paint: {
          "line-color": "#F0A020",
          "line-width": 2,
          "line-dasharray": [4, 3],
          "line-opacity": 0.9,
        },
      });

      void fetch("/api/demo/burn-perimeter")
        .then((r) => (r.ok ? r.json() : null))
        .then((gj: unknown) => {
          if (gj === null) return;
          const src = m.getSource("burn-perimeter") as maplibregl.GeoJSONSource | undefined;
          src?.setData(gj as GeoJSON.Feature);
        })
        .catch(() => undefined);

      // Simulated fire front — filled, plus a bright leading edge
      m.addSource("fire-front", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      m.addLayer({
        id: "fire-fill",
        type: "fill",
        source: "fire-front",
        paint: { "fill-color": "#CC1020", "fill-opacity": 0.35 },
      });
      m.addLayer({
        id: "fire-edge",
        type: "line",
        source: "fire-front",
        paint: { "line-color": "#FF6A00", "line-width": 3, "line-blur": 1 },
      });

        setReady(true);
      } catch (error) {
        console.error("[valoris map] layer initialisation failed", error);
      }
    };

    if (m.isStyleLoaded()) initLayers();
    else m.once("load", initLayers);

    m.on("error", (e) => {
      // Tile failures are survivable — our own layers still draw. Log, do not
      // let a basemap problem take the operational picture down with it.
      console.warn("[valoris map]", e.error?.message ?? e);
    });

    // MapLibre only listens for WINDOW resizes. When the container itself
    // changes size — a panel opening, a breakpoint flip — the canvas keeps its
    // old dimensions and the map looks cropped or blank.
    const observer = new ResizeObserver(() => m.resize());
    observer.observe(container.current);

    map.current = m;
    return () => {
      observer.disconnect();
      m.remove();
      map.current = null;
      setReady(false);
    };
  }, []);

  /* --- Push fire front and crew on every snapshot ------------------------ */
  useEffect(() => {
    const m = map.current;
    if (m === null || !ready || snapshot === null) return;

    const perimeter = snapshot.fireFront.perimeter ?? [];
    const source = m.getSource("fire-front") as maplibregl.GeoJSONSource | undefined;
    const first = perimeter[0];
    if (source !== undefined) {
      source.setData(
        perimeter.length >= 3 && first !== undefined
          ? {
              type: "Feature",
              properties: {},
              geometry: {
                type: "Polygon",
                // GeoJSON rings must close, so repeat the first point.
                coordinates: [
                  [...perimeter.map((p) => [p.lng, p.lat]), [first.lng, first.lat]],
                ],
              },
            }
          : { type: "FeatureCollection", features: [] },
      );
    }

    for (const f of snapshot.firefighters) {
      if (f.latest === null) continue;
      const band = asBand(f.risk?.band);
      const p = presentation(band, f.risk?.dataQuality.missingInputs);
      const isSelected = selected === f.callsign;

      let marker = markers.current[f.callsign];
      if (marker === undefined) {
        const el = document.createElement("div");
        el.style.cursor = "pointer";
        el.addEventListener("click", (e) => {
          e.stopPropagation();
          onSelectRef.current(f.callsign);
        });
        marker = new maplibregl.Marker({ element: el }).setLngLat([f.latest.lng, f.latest.lat]).addTo(m);
        markers.current[f.callsign] = marker;
      }

      marker.setLngLat([f.latest.lng, f.latest.lat]);
      const el = marker.getElement();
      el.innerHTML = `
        <div style="display:flex;align-items:center;gap:6px;transform:translate(-50%,-50%)">
          <div style="
            width:${isSelected ? 34 : 28}px;height:${isSelected ? 34 : 28}px;border-radius:50%;
            background:${p.greyed ? "rgba(122,130,174,0.35)" : p.colour};
            border:${isSelected ? 4 : 3}px ${p.greyed ? "dashed" : "solid"} ${isSelected ? "#E8ECF8" : p.colour};
            display:flex;align-items:center;justify-content:center;
            font:700 ${isSelected ? 17 : 14}px ui-monospace,monospace;
            color:${p.greyed ? "#E8ECF8" : "#05060F"};
            box-shadow:0 0 ${p.greyed ? 0 : 14}px ${p.colour};
          ">${p.glyph}</div>
          <div style="
            background:rgba(5,6,15,0.82);padding:2px 6px;border-radius:3px;
            border-left:3px solid ${p.colour};
            font:700 12px ui-monospace,monospace;color:#E8ECF8;white-space:nowrap;
          ">${f.callsign}${p.badge === null ? "" : ` <span style="color:${BAND_COLOUR.UNKNOWN}">${p.badge}</span>`}</div>
        </div>`;
    }
  }, [snapshot, selected, ready]);

  const toggleBasemap = () => {
    const m = map.current;
    if (m === null || !ready) return;
    if (basemapOn) {
      if (m.getLayer("carto") !== undefined) m.removeLayer("carto");
      if (m.getSource("carto") !== undefined) m.removeSource("carto");
      setBasemapOn(false);
      return;
    }
    try {
      m.addSource("carto", {
        type: "raster",
        tiles: [
          "https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png",
          "https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png",
          "https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png",
        ],
        tileSize: 256,
        attribution: "© OpenStreetMap contributors © CARTO",
      });
      // Beneath everything of ours — the basemap is context, not content.
      m.addLayer(
        { id: "carto", type: "raster", source: "carto", paint: { "raster-opacity": 0.8 } },
        "safe-zone-fill",
      );
      setBasemapOn(true);
    } catch (error) {
      console.warn("[valoris map] basemap unavailable", error);
    }
  };

  return (
    <div className="relative h-full w-full overflow-hidden rounded" style={{ border: `1px solid ${COLOURS.border}` }}>
      <div ref={container} className="h-full w-full" />

      <button
        onClick={toggleBasemap}
        className="absolute right-2 top-2 z-10 rounded px-2 py-1 text-[11px] font-semibold"
        style={{
          background: basemapOn ? "#1E2650" : "rgba(5,6,15,0.85)",
          border: `1px solid ${COLOURS.border}`,
          color: COLOURS.text,
        }}
      >
        BASEMAP {basemapOn ? "ON" : "OFF"}
      </button>
      <div
        className="pointer-events-none absolute left-2 top-2 rounded px-2 py-1 text-[11px]"
        style={{ background: "rgba(5,6,15,0.85)", color: COLOURS.muted, border: `1px solid ${COLOURS.border}` }}
      >
        <span style={{ color: COLOURS.text }}>Pacific Palisades</span> · ignition
        34.0725, −118.5425
        <br />
        <span style={{ color: BAND_COLOUR.CAUTION }}>▭ dashed amber</span> = REAL
        NIFC burn perimeter, Jan 2025 (Tier A)
        <br />
        <span style={{ color: "#FF6A00" }}>▬ solid orange</span> = SIMULATED front
        — placeholder, not a fire behaviour prediction
        <br />
        <span style={{ color: BAND_COLOUR.UNKNOWN }}>● crew</span> = simulated
        deployment positions, never real
      </div>
    </div>
  );
}
