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

const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

/**
 * Outer ring for the SAFE wash. The green region is everything OUTSIDE the
 * safe contour, which has no natural outer edge, so it is drawn as a large box
 * with the contour punched out of it as a hole. Comfortably larger than any
 * view the demo uses.
 */
const WORLD_BOX: number[][] = [
  [-119.4, 33.4],
  [-117.7, 33.4],
  [-117.7, 34.8],
  [-119.4, 34.8],
  [-119.4, 33.4],
];

/**
 * The four risk regions, painted outermost first so the nested rings read as
 * filled bands. `ring` names which contour bounds the region: everything inside
 * `polygons.SAFE` is CAUTION or worse, inside `polygons.CAUTION` is HIGH or
 * worse, and so on.
 */
const ZONES = [
  { id: "zone-safe", ring: "SAFE", colour: BAND_COLOUR.SAFE, opacity: 0.14, hole: true },
  { id: "zone-caution", ring: "SAFE", colour: BAND_COLOUR.CAUTION, opacity: 0.22, hole: false },
  { id: "zone-high", ring: "CAUTION", colour: BAND_COLOUR.HIGH, opacity: 0.26, hole: false },
  { id: "zone-critical", ring: "HIGH", colour: BAND_COLOUR.CRITICAL, opacity: 0.32, hole: false },
] as const;

/** Bearing index used to park the zone captions, out of 48. South-west. */
const LABEL_AT = 30;

type ContourResponse = {
  incidentMinutes: number;
  searchLimitM: number;
  polygonsFor: string | null;
  firePerimeter: number[][] | null;
  polygons: Record<string, number[][]> | null;
  contours: {
    callsign: string;
    ageYears: number;
    conditions: string[];
    currentBand: string;
    currentDistanceM: number;
    cautionBoundaryM: number | null;
    safeBoundaryM: number | null;
  }[];
};

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
  const [contour, setContour] = useState<ContourResponse | null>(null);
  /**
   * Keep the contours framed as they grow. The fire starts a few hundred metres
   * across and ends up kilometres wide; at a fixed zoom the whole risk picture
   * is either a speck or off the edge of the screen. Any manual pan or zoom
   * hands control back to the operator.
   */
  const [followFire, setFollowFire] = useState(true);
  const followFireRef = useRef(true);
  followFireRef.current = followFire;
  const contourInFlight = useRef(false);
  const zoneLabels = useRef<Record<string, maplibregl.Marker>>({});
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  /**
   * Whose contours the map is drawing. The zones are meaningless without a
   * person attached to them, so with nobody selected it falls back to the first
   * of the crew rather than showing an unattributed picture.
   */
  const contourFor = selected ?? snapshot?.firefighters[0]?.callsign ?? null;

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
      /*
        PERSONALISED RISK CONTOURS — added first, so they sit at the bottom of
        the stack and everything else reads over them.

        These are not a buffer drawn at a fixed distance from the fire. Each
        contour is the locus of points where the real engine changes ITS answer
        for ONE named firefighter, so selecting a different person redraws the
        map. That is the product in a single picture.
      */
      for (const zone of ZONES) {
        m.addSource(zone.id, { type: "geojson", data: EMPTY });
        m.addLayer({
          id: `${zone.id}-fill`,
          type: "fill",
          source: zone.id,
          paint: { "fill-color": zone.colour, "fill-opacity": zone.opacity },
        });
      }

      // Boundaries as their own source, so each ring gets a dashed edge in its
      // own colour without the SAFE region's outer box being drawn too.
      m.addSource("zone-edges", { type: "geojson", data: EMPTY });
      m.addLayer({
        id: "zone-edges-line",
        type: "line",
        source: "zone-edges",
        paint: {
          "line-color": ["get", "colour"],
          "line-width": 2.5,
          "line-dasharray": [3, 2],
          "line-opacity": 0.95,
        },
      });

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

    // Touching the map means the operator wants to look somewhere specific;
    // stop dragging the viewport out from under them.
    const releaseFollow = () => setFollowFire(false);
    m.on("dragstart", releaseFollow);
    m.on("wheel", releaseFollow);

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
      for (const marker of Object.values(zoneLabels.current)) marker.remove();
      zoneLabels.current = {};
      markers.current = {};
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

  /* --- Personalised contours for whoever is selected --------------------- */
  useEffect(() => {
    if (!ready || snapshot === null || contourFor === null) return;

    let cancelled = false;

    // One request in flight at a time. The sweep is thousands of engine
    // evaluations; if it ever runs slower than the poll interval, queuing them
    // up would make it worse rather than better.
    if (contourInFlight.current) return;
    contourInFlight.current = true;

    void fetch(
      `/api/demo/contours?incidentId=${snapshot.incident.id}&callsign=${encodeURIComponent(contourFor)}`,
    )
      .then((r) => (r.ok ? (r.json() as Promise<{ data?: ContourResponse }>) : null))
      .then((body) => {
        if (!cancelled && body != null) setContour(body.data ?? (body as unknown as ContourResponse));
      })
      .catch(() => undefined)
      .finally(() => {
        contourInFlight.current = false;
      });

    return () => {
      cancelled = true;
    };
  }, [snapshot, contourFor, ready]);

  /* --- Paint the contours ------------------------------------------------ */
  useEffect(() => {
    const m = map.current;
    if (m === null || !ready) return;

    const rings = contour?.polygons ?? null;

    for (const zone of ZONES) {
      const src = m.getSource(zone.id) as maplibregl.GeoJSONSource | undefined;
      if (src === undefined) continue;

      const ring = rings?.[zone.ring];
      if (ring === undefined || ring.length < 4) {
        src.setData(EMPTY);
        continue;
      }

      src.setData({
        type: "Feature",
        properties: {},
        geometry: {
          type: "Polygon",
          // The SAFE wash is the box with the contour punched out; the rest are
          // plain nested polygons painted over one another.
          coordinates: zone.hole ? [WORLD_BOX, ring] : [ring],
        },
      });
    }

    const edges = m.getSource("zone-edges") as maplibregl.GeoJSONSource | undefined;
    if (edges !== undefined) {
      const features: GeoJSON.Feature[] = [];
      for (const band of ["SAFE", "CAUTION", "HIGH"] as const) {
        const ring = rings?.[band];
        if (ring === undefined || ring.length < 4) continue;
        features.push({
          type: "Feature",
          properties: { colour: BAND_COLOUR[band] },
          geometry: { type: "LineString", coordinates: ring },
        });
      }
      edges.setData({ type: "FeatureCollection", features });
    }

    // Captions sitting on their own contour. DOM markers rather than a symbol
    // layer: symbol text needs a glyph server, and the map is deliberately
    // self-contained so it works with no network.
    const captions: { key: string; ring: string; text: string; colour: string }[] = [
      { key: "safe", ring: "SAFE", text: "SAFE", colour: BAND_COLOUR.SAFE },
      { key: "caution", ring: "CAUTION", text: "CAUTION", colour: BAND_COLOUR.CAUTION },
      { key: "high", ring: "HIGH", text: "DANGER", colour: BAND_COLOUR.HIGH },
    ];

    for (const caption of captions) {
      const ring = rings?.[caption.ring];
      const point = ring?.[LABEL_AT];
      let marker = zoneLabels.current[caption.key];

      if (point === undefined || ring === undefined || ring.length < 4) {
        marker?.remove();
        delete zoneLabels.current[caption.key];
        continue;
      }

      if (marker === undefined) {
        const el = document.createElement("div");
        el.style.pointerEvents = "none";
        marker = new maplibregl.Marker({ element: el }).setLngLat([
          point[0] as number,
          point[1] as number,
        ]);
        marker.addTo(m);
        zoneLabels.current[caption.key] = marker;
      }

      marker.setLngLat([point[0] as number, point[1] as number]);
      marker.getElement().innerHTML = `
        <div style="
          transform:translate(-50%,-50%);
          font:800 15px ui-monospace,monospace;letter-spacing:2px;
          color:${caption.colour};
          text-shadow:0 0 8px rgba(5,6,15,0.95),0 0 3px rgba(5,6,15,1);
          white-space:nowrap;
        ">${caption.text}</div>`;
    }

    // Frame the outermost contour. Padded, so the SAFE band stays visible
    // rather than sitting exactly on the edge of the canvas.
    const outer = rings?.SAFE;
    if (followFireRef.current && outer !== undefined && outer.length >= 4) {
      const bounds = new maplibregl.LngLatBounds();
      for (const point of outer) {
        bounds.extend([point[0] as number, point[1] as number]);
      }
      m.fitBounds(bounds, { padding: 70, duration: 600, maxZoom: 16 });
    }
  }, [contour, ready, followFire]);

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
      // Beneath everything of ours — the basemap is context, not content. The
      // insert target is the first ZONES layer, which is now the bottom of our
      // stack; anchoring to the safe zone would bury the contours.
      m.addLayer(
        { id: "carto", type: "raster", source: "carto", paint: { "raster-opacity": 0.8 } },
        "zone-safe-fill",
      );
      setBasemapOn(true);
    } catch (error) {
      console.warn("[valoris map] basemap unavailable", error);
    }
  };

  return (
    <div className="relative h-full w-full overflow-hidden rounded" style={{ border: `1px solid ${COLOURS.border}` }}>
      <div ref={container} className="h-full w-full" />

      <div className="absolute right-2 top-2 z-10 flex gap-1">
        <button
          onClick={() => setFollowFire((v) => !v)}
          className="rounded px-2 py-1 text-[11px] font-semibold"
          style={{
            background: followFire ? "#1E2650" : "rgba(5,6,15,0.85)",
            border: `1px solid ${followFire ? COLOURS.text : COLOURS.border}`,
            color: COLOURS.text,
          }}
        >
          FOLLOW {followFire ? "ON" : "OFF"}
        </button>
        <button
          onClick={toggleBasemap}
          className="rounded px-2 py-1 text-[11px] font-semibold"
          style={{
            background: basemapOn ? "#1E2650" : "rgba(5,6,15,0.85)",
            border: `1px solid ${COLOURS.border}`,
            color: COLOURS.text,
          }}
        >
          BASEMAP {basemapOn ? "ON" : "OFF"}
        </button>
      </div>

      {/*
        The zones mean nothing without a name attached. Two firefighters get
        different contours from the same fire, so the map must always say whose
        picture it is currently drawing.
      */}
      {contourFor !== null && (
        <div
          className="pointer-events-none absolute bottom-2 left-1/2 z-10 -translate-x-1/2 rounded px-3 py-1.5 text-center"
          style={{
            background: "rgba(5,6,15,0.9)",
            border: `1px solid ${COLOURS.border}`,
          }}
        >
          <div className="text-[10px] uppercase tracking-wider" style={{ color: COLOURS.muted }}>
            personalised risk zones for
          </div>
          <div className="font-mono text-sm font-bold" style={{ color: COLOURS.text }}>
            {contourFor}
          </div>
          <div className="text-[10px]" style={{ color: COLOURS.muted }}>
            select another firefighter to redraw
          </div>
        </div>
      )}
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
