"use client";

/**
 * Commander view — the Palisades fire on a timeline, with a deployed crew.
 *
 * Three things happen here that a static risk table cannot show:
 *
 *   1. The timeline is scrubbed, not played. The whole picture is a pure
 *      function of (time, crew positions), so dragging backwards is as valid as
 *      dragging forwards and nothing accumulates or drifts.
 *   2. Crew markers are DRAGGED. Moving someone re-runs the real engine at the
 *      new position, so the commander can ask "what if I put them there"
 *      directly on the map.
 *   3. The three zones are PERSONAL. They are computed for the selected
 *      firefighter from their own health profile, so the same fire produces a
 *      different map for a 28-year-old with no conditions than for a
 *      52-year-old with asthma.
 *
 * The contours are offsets from the fire outline applied along each bearing, so
 * they inherit its shape: a round fire gets round contours, and this fire —
 * which is very much not round — gets contours that follow its lobes.
 *
 * SIMULATION MODE — NOT FOR OPERATIONAL USE.
 */

import maplibregl from "maplibre-gl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { BAND_COLOUR, COLOURS } from "./theme";

const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

/** Outer ring for the SAFE wash — the green region has no natural outer edge. */
const WORLD_BOX: number[][] = [
  [-119.6, 33.2],
  [-117.4, 33.2],
  [-117.4, 35.0],
  [-119.6, 35.0],
  [-119.6, 33.2],
];

const ZONE_COLOUR = {
  DANGER: BAND_COLOUR.CRITICAL,
  CAUTION: BAND_COLOUR.CAUTION,
  SAFE: BAND_COLOUR.SAFE,
  UNKNOWN: BAND_COLOUR.UNKNOWN,
} as const;

type Geo = {
  originLat: number;
  originLng: number;
  mPerDegLat: number;
  mPerDegLng: number;
  bearings: number;
};

type Crew = {
  callsign: string;
  lat: number;
  lng: number;
  separationM: number;
  band: string;
  score: number;
  confidence: string;
  zone: keyof typeof ZONE_COLOUR;
  dangerOffsetM: number | null;
  cautionOffsetM: number | null;
  hrBpm: number;
  spo2Pct: number;
  coreTempC: number;
  fatiguePct: number;
  cohbPct: number;
  timeOnTaskMin: number;
  ageYears: number;
  fitness: string;
  conditions: string[];
};

type Scene = {
  atMs: number;
  atUtc: string;
  timelineStartMs: number;
  timelineEndMs: number;
  areaFraction: number;
  acres: number;
  fireMaxRadiusM: number;
  maxOffsetM: number;
  perimeterRadii: number[];
  geo: Geo;
  crew: Crew[];
  provenance: Record<string, string>;
};

/**
 * Build a closed ring from the fire's radius-per-bearing array, pushed outward
 * by a constant offset. This is what makes the contours follow the fire's
 * shape rather than being circles drawn around it.
 */
function ringFrom(radii: number[], offsetM: number, geo: Geo): number[][] {
  const ring: number[][] = [];
  for (let b = 0; b < radii.length; b += 1) {
    const angle = (b / radii.length) * Math.PI * 2;
    const r = (radii[b] as number) + offsetM;
    ring.push([
      geo.originLng + (Math.sin(angle) * r) / geo.mPerDegLng,
      geo.originLat + (Math.cos(angle) * r) / geo.mPerDegLat,
    ]);
  }
  ring.push(ring[0] as number[]);
  return ring;
}

function polygon(coordinates: number[][][]): GeoJSON.Feature {
  return { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates } };
}

function formatUtc(ms: number): string {
  const d = new Date(ms);
  const day = d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    timeZone: "UTC",
  });
  const time = d.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  });
  return `${day} ${time}Z`;
}

export function CommanderView() {
  const container = useRef<HTMLDivElement | null>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const markers = useRef<Record<string, maplibregl.Marker>>({});
  const inFlight = useRef(false);
  const pending = useRef(false);

  const [ready, setReady] = useState(false);
  const [basemapOn, setBasemapOn] = useState(true);
  const [scene, setScene] = useState<Scene | null>(null);
  const [selected, setSelected] = useState<string>("BRAVO-2");
  const [atMs, setAtMs] = useState<number | null>(null);
  /** Crew positions, once the commander has moved anyone. */
  const [placements, setPlacements] = useState<
    { callsign: string; lat: number; lng: number }[] | null
  >(null);

  const selectedRef = useRef(selected);
  selectedRef.current = selected;

  /* --- Fetch the scene ---------------------------------------------------- */
  const load = useCallback(
    async (whenMs: number | null, crew: typeof placements) => {
      if (inFlight.current) {
        pending.current = true;
        return;
      }
      inFlight.current = true;
      try {
        const body: Record<string, unknown> = {
          atMs: whenMs ?? Date.parse("2025-01-08T14:00:00Z"),
        };
        if (crew !== null) body.crew = crew;

        const response = await fetch("/api/demo/scene", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (response.ok) {
          const data = (await response.json()) as Scene;
          setScene(data);
          setAtMs((current) => current ?? data.atMs);
        }
      } catch {
        // A dropped scene is not fatal; the next scrub will land.
      } finally {
        inFlight.current = false;
        if (pending.current) {
          pending.current = false;
          void load(whenMs, crew);
        }
      }
    },
    [],
  );

  // `load` is a useCallback with no dependencies, so it is stable and safe to
  // list here: this re-runs only when the time or the crew placements change.
  useEffect(() => {
    void load(atMs, placements);
  }, [atMs, placements, load]);

  /* --- Create the map once ------------------------------------------------ */
  useEffect(() => {
    if (container.current === null || map.current !== null) return;

    const m = new maplibregl.Map({
      container: container.current,
      // Boots with no external source, so the operational picture never depends
      // on reaching a tile server. The basemap is added afterwards.
      style: {
        version: 8,
        sources: {},
        layers: [
          { id: "bg", type: "background", paint: { "background-color": COLOURS.background } },
        ],
      },
      center: [-118.5425, 34.0725],
      zoom: 10.4,
      attributionControl: false,
    });

    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    m.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");
    m.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");

    const init = () => {
      try {
        for (const id of ["zone-safe", "zone-caution", "zone-danger", "fire"]) {
          m.addSource(id, { type: "geojson", data: EMPTY });
        }

        m.addLayer({
          id: "zone-safe-fill",
          type: "fill",
          source: "zone-safe",
          paint: { "fill-color": ZONE_COLOUR.SAFE, "fill-opacity": 0.13 },
        });
        m.addLayer({
          id: "zone-caution-fill",
          type: "fill",
          source: "zone-caution",
          paint: { "fill-color": ZONE_COLOUR.CAUTION, "fill-opacity": 0.24 },
        });
        m.addLayer({
          id: "zone-danger-fill",
          type: "fill",
          source: "zone-danger",
          paint: { "fill-color": ZONE_COLOUR.DANGER, "fill-opacity": 0.3 },
        });
        m.addLayer({
          id: "fire-fill",
          type: "fill",
          source: "fire",
          paint: { "fill-color": "#C4121F", "fill-opacity": 0.62 },
        });

        m.addLayer({
          id: "zone-caution-line",
          type: "line",
          source: "zone-caution",
          paint: {
            "line-color": ZONE_COLOUR.CAUTION,
            "line-width": 2,
            "line-dasharray": [3, 2],
          },
        });
        m.addLayer({
          id: "zone-danger-line",
          type: "line",
          source: "zone-danger",
          paint: {
            "line-color": ZONE_COLOUR.DANGER,
            "line-width": 2,
            "line-dasharray": [3, 2],
          },
        });
        m.addLayer({
          id: "fire-edge",
          type: "line",
          source: "fire",
          paint: { "line-color": "#FF7A1A", "line-width": 2.5 },
        });

        setReady(true);
      } catch (error) {
        console.error("[valoris] layer init failed", error);
      }
    };

    /*
      Initialise on whichever signal arrives first, and keep checking.

      `load` is a one-shot event. If the style is already loaded when the
      listener attaches — a re-mount, a cached style, React's development
      double-invoke tearing the first map down mid-load — the event never comes,
      `init` never runs, and the map sits there with a canvas, a scale bar and
      no layers at all. That failure is completely silent: no error, no warning,
      just an empty map. It cost a debugging session once already.

      So: try immediately, listen for `load`, and also poll briefly as a
      backstop. `initialised` makes it idempotent whichever fires first.
    */
    let initialised = false;
    const initOnce = () => {
      if (initialised || m.getSource("fire") !== undefined) return;
      initialised = true;
      init();
    };

    if (m.isStyleLoaded()) initOnce();
    m.once("load", initOnce);
    m.on("styledata", initOnce);

    const poll = setInterval(() => {
      if (initialised) {
        clearInterval(poll);
        return;
      }
      if (m.isStyleLoaded()) initOnce();
    }, 150);

    m.on("error", (e) => console.warn("[valoris map]", e.error?.message ?? e));

    const observer = new ResizeObserver(() => m.resize());
    observer.observe(container.current);

    map.current = m;
    return () => {
      clearInterval(poll);
      observer.disconnect();
      for (const marker of Object.values(markers.current)) marker.remove();
      markers.current = {};
      m.remove();
      map.current = null;
      setReady(false);
    };
  }, []);

  /* --- Basemap ------------------------------------------------------------ */
  useEffect(() => {
    const m = map.current;
    if (m === null || !ready) return;

    const has = m.getLayer("carto") !== undefined;
    if (basemapOn && !has) {
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
        m.addLayer(
          { id: "carto", type: "raster", source: "carto", paint: { "raster-opacity": 0.75 } },
          "zone-safe-fill",
        );
      } catch (error) {
        console.warn("[valoris] basemap unavailable", error);
      }
    } else if (!basemapOn && has) {
      m.removeLayer("carto");
      if (m.getSource("carto") !== undefined) m.removeSource("carto");
    }
  }, [basemapOn, ready]);

  const selectedCrew = useMemo(
    () => scene?.crew.find((c) => c.callsign === selected) ?? null,
    [scene, selected],
  );

  /* --- Paint fire, zones and crew ----------------------------------------- */
  useEffect(() => {
    const m = map.current;
    if (m === null || !ready || scene === null) return;

    const { perimeterRadii: radii, geo } = scene;
    const fireRing = ringFrom(radii, 0, geo);

    const set = (id: string, feature: GeoJSON.Feature | null) => {
      const source = m.getSource(id) as maplibregl.GeoJSONSource | undefined;
      source?.setData(feature ?? EMPTY);
    };

    set("fire", polygon([fireRing]));

    // Zones belong to the selected firefighter. Painted nested: the SAFE wash is
    // the world with their safe contour punched out, then CAUTION over it, then
    // DANGER, then the fire itself on top.
    if (selectedCrew === null) {
      set("zone-safe", null);
      set("zone-caution", null);
      set("zone-danger", null);
    } else {
      const safeOffset = selectedCrew.cautionOffsetM ?? scene.maxOffsetM;
      const dangerOffset = selectedCrew.dangerOffsetM ?? scene.maxOffsetM;

      const safeRing = ringFrom(radii, safeOffset, geo);
      set("zone-safe", polygon([WORLD_BOX, safeRing]));
      set("zone-caution", polygon([safeRing]));
      set("zone-danger", polygon([ringFrom(radii, dangerOffset, geo)]));
    }

    // Crew markers — draggable, always labelled.
    const seen = new Set<string>();
    for (const member of scene.crew) {
      seen.add(member.callsign);
      const isSelected = member.callsign === selected;
      const colour = ZONE_COLOUR[member.zone] ?? ZONE_COLOUR.UNKNOWN;

      let marker = markers.current[member.callsign];
      if (marker === undefined) {
        const el = document.createElement("div");
        el.style.cursor = "grab";
        marker = new maplibregl.Marker({ element: el, draggable: true })
          .setLngLat([member.lng, member.lat])
          .addTo(m);

        const callsign = member.callsign;
        el.addEventListener("click", (event) => {
          event.stopPropagation();
          setSelected(callsign);
        });
        marker.on("dragend", () => {
          const at = marker!.getLngLat();
          // Freeze the whole crew into explicit placements on first drag, so the
          // server stops falling back to defaults for everyone else.
          setPlacements((current) => {
            const base =
              current ??
              scene.crew.map((c) => ({ callsign: c.callsign, lat: c.lat, lng: c.lng }));
            return base.map((p) =>
              p.callsign === callsign ? { ...p, lat: at.lat, lng: at.lng } : p,
            );
          });
        });

        markers.current[member.callsign] = marker;
      } else {
        marker.setLngLat([member.lng, member.lat]);
      }

      marker.getElement().innerHTML = `
        <div style="display:flex;align-items:center;gap:5px;transform:translate(-50%,-50%)">
          <div style="
            width:${isSelected ? 20 : 15}px;height:${isSelected ? 20 : 15}px;border-radius:50%;
            background:${colour};
            border:${isSelected ? 4 : 2}px solid ${isSelected ? "#FFFFFF" : "#05060F"};
            box-shadow:0 0 10px ${colour};
          "></div>
          <div style="
            background:rgba(5,6,15,0.88);padding:2px 5px;border-radius:3px;
            border-left:3px solid ${colour};
            font:700 11px ui-monospace,monospace;color:#E8ECF8;white-space:nowrap;
          ">${member.callsign}<span style="color:${colour}"> ${member.zone}</span></div>
        </div>`;
    }

    for (const [callsign, marker] of Object.entries(markers.current)) {
      if (!seen.has(callsign)) {
        marker.remove();
        delete markers.current[callsign];
      }
    }
  }, [scene, ready, selected, selectedCrew]);

  const start = scene?.timelineStartMs ?? Date.parse("2025-01-07T18:30:00Z");
  const end = scene?.timelineEndMs ?? Date.parse("2025-01-31T18:00:00Z");
  const current = atMs ?? scene?.atMs ?? start;

  const chip = (zone: string) => ({
    background: `${ZONE_COLOUR[zone as keyof typeof ZONE_COLOUR] ?? ZONE_COLOUR.UNKNOWN}22`,
    color: ZONE_COLOUR[zone as keyof typeof ZONE_COLOUR] ?? ZONE_COLOUR.UNKNOWN,
    border: `1px solid ${ZONE_COLOUR[zone as keyof typeof ZONE_COLOUR] ?? ZONE_COLOUR.UNKNOWN}`,
  });

  return (
    <div
      className="flex min-h-screen flex-col"
      style={{ background: COLOURS.background, color: COLOURS.text }}
    >
      <div
        className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm font-bold"
        style={{ background: "#F0A020", color: "#05060F" }}
      >
        <span>SIMULATION MODE — NOT FOR OPERATIONAL USE</span>
        <span className="font-mono text-xs">
          PALISADES FIRE · JAN 2025 · {scene === null ? "loading…" : `${scene.acres.toLocaleString()} acres`}
        </span>
      </div>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* Map */}
        <div className="relative h-[58vh] min-w-0 flex-[3] lg:h-[calc(100vh-9.5rem)]">
          <div ref={container} className="h-full w-full" />

          <button
            onClick={() => setBasemapOn((v) => !v)}
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
            className="pointer-events-none absolute left-2 top-2 max-w-[22rem] rounded px-2 py-1.5 text-[10px] leading-relaxed"
            style={{
              background: "rgba(5,6,15,0.88)",
              color: COLOURS.muted,
              border: `1px solid ${COLOURS.border}`,
            }}
          >
            <div style={{ color: COLOURS.text, fontWeight: 700 }}>
              Risk zones for {selected}
            </div>
            Zones are personal — they are computed from this firefighter&apos;s health
            profile, so selecting someone else redraws them.
            <br />
            <span style={{ color: "#FF7A1A" }}>▬ fire</span> · shape is the REAL NIFC
            perimeter; growth between snapshots is interpolated and is{" "}
            <b>not a fire prediction</b>
            <br />
            <span style={{ color: COLOURS.text }}>Drag any crew marker</span> to ask what
            happens if you move them.
          </div>
        </div>

        {/* Crew */}
        <div
          className="flex h-[58vh] min-w-[330px] flex-[2] flex-col overflow-y-auto lg:h-[calc(100vh-9.5rem)]"
          style={{ borderLeft: `1px solid ${COLOURS.border}` }}
        >
          {scene === null ? (
            <div className="p-4 text-sm" style={{ color: COLOURS.muted }}>
              Loading scene…
            </div>
          ) : (
            scene.crew.map((member) => {
              const isSelected = member.callsign === selected;
              return (
                <button
                  key={member.callsign}
                  onClick={() => setSelected(member.callsign)}
                  className="w-full px-3 py-2 text-left"
                  style={{
                    borderBottom: `1px solid ${COLOURS.border}`,
                    background: isSelected ? "#141A38" : "transparent",
                    borderLeft: `4px solid ${isSelected ? ZONE_COLOUR[member.zone] : "transparent"}`,
                  }}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-sm font-bold">{member.callsign}</span>
                    <span
                      className="rounded px-2 py-0.5 text-[10px] font-bold"
                      style={chip(member.zone)}
                    >
                      {member.zone}
                    </span>
                  </div>
                  <div className="mt-0.5 text-[11px]" style={{ color: COLOURS.muted }}>
                    {member.ageYears} yrs · {member.fitness} fitness ·{" "}
                    {member.conditions.length === 0
                      ? "no conditions"
                      : member.conditions.join(", ")}
                  </div>
                  <div className="mt-1 font-mono text-[11px]" style={{ color: COLOURS.text }}>
                    {member.separationM < 0
                      ? `${Math.abs(member.separationM)} m INSIDE perimeter`
                      : `${member.separationM} m from fire`}
                    {" · "}
                    <span style={{ color: COLOURS.muted }}>
                      safe beyond{" "}
                      {member.cautionOffsetM === null
                        ? `>${scene.maxOffsetM} m`
                        : `${member.cautionOffsetM} m`}
                    </span>
                  </div>
                  <div className="mt-0.5 font-mono text-[10px]" style={{ color: COLOURS.muted }}>
                    HR {member.hrBpm} · SpO2 {member.spo2Pct}% · core {member.coreTempC} °C ·
                    COHb {member.cohbPct}%
                  </div>
                </button>
              );
            })
          )}

          {selectedCrew !== null && (
            <div className="p-3 text-[11px]" style={{ color: COLOURS.muted }}>
              <div className="mb-1 font-bold" style={{ color: COLOURS.text }}>
                Why {selectedCrew.callsign}&apos;s zones differ
              </div>
              The engine scores every firefighter against thresholds calibrated to their
              age, fitness and conditions, so the distance at which the answer changes is
              personal. {selectedCrew.callsign} is safe beyond{" "}
              <b style={{ color: ZONE_COLOUR.SAFE }}>
                {selectedCrew.cautionOffsetM === null
                  ? `more than ${scene?.maxOffsetM} m`
                  : `${selectedCrew.cautionOffsetM} m`}
              </b>{" "}
              from the fire edge. Each contour is the locus where the real engine changes
              its answer — not a buffer drawn at a fixed distance.
            </div>
          )}
        </div>
      </div>

      {/* Timeline */}
      <div
        className="px-4 py-2"
        style={{ borderTop: `1px solid ${COLOURS.border}`, background: COLOURS.panel }}
      >
        <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
          <span className="font-mono text-sm font-bold" style={{ color: COLOURS.text }}>
            {formatUtc(current)}
          </span>
          <span className="text-[11px]" style={{ color: COLOURS.muted }}>
            {scene === null
              ? ""
              : `${scene.acres.toLocaleString()} acres · fire extends ${(scene.fireMaxRadiusM / 1000).toFixed(1)} km from ignition`}
          </span>
        </div>
        <input
          type="range"
          min={start}
          max={end}
          step={30 * 60_000}
          value={current}
          onChange={(e) => setAtMs(Number(e.target.value))}
          className="w-full"
          style={{ accentColor: "#F0A020" }}
        />
        <div className="flex justify-between text-[10px]" style={{ color: COLOURS.muted }}>
          <span>7 Jan — ignition</span>
          <span>scrub the timeline</span>
          <span>31 Jan — contained</span>
        </div>
      </div>
    </div>
  );
}
