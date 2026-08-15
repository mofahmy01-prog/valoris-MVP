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

/** Recon drones and their footprints — deliberately not a band colour. */
const RECON_COLOUR = "#4FD8E8";
/** Wall-clock flight time for a dispatched response drone, base to casualty. */
const RESPONSE_FLIGHT_MS = 10_000;
/** Wall-clock time for the escort leg, casualty to their own safe contour. */
const ESCORT_MS = 10_000;
const RESPONSE_COLOUR = "#B98CFF";

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
  reconCoverage: boolean;
  ageYears: number;
  fitness: string;
  conditions: string[];
};

type Drone = {
  id: string;
  kind: "recon" | "response";
  lat: number;
  lng: number;
  status: "on_station" | "en_route" | "arrived";
  coverageRadiusM: number | null;
  assignedTo: string | null;
  etaSec: number | null;
};

type Dispatch = {
  id: string;
  targetCallsign: string;
  /** Where the crew member stood when the drone was launched. */
  fromLat: number;
  fromLng: number;
  /**
   * Where they are being taken: the nearest point beyond THEIR OWN safe
   * contour. Different for every firefighter, which is the point.
   */
  toLat: number;
  toLng: number;
  /** Wall clock, not timeline clock — the flight is an animation. */
  dispatchedAtWallMs: number;
  /**
   * Set once the engine reports this firefighter SAFE, which ends the escort
   * wherever they happen to be standing.
   */
  arrived?: boolean;
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
  drones: Drone[];
  droneBase: { lat: number; lng: number };
  provenance: Record<string, string>;
  incidentRecord: Record<string, string | number | null>;
};

/** Labels for the provenance keys, in the order they should be read. */
const PROVENANCE_ORDER: { key: string; label: string; tier: "REAL" | "UNVERIFIED" | "SYNTHETIC" }[] = [
  { key: "riskEngine", label: "Risk engine", tier: "REAL" },
  { key: "perimeterShape", label: "Fire outline", tier: "REAL" },
  { key: "timelineEndpoints", label: "Timeline endpoints", tier: "REAL" },
  { key: "growthTiming", label: "Growth timing", tier: "UNVERIFIED" },
  { key: "polygonDateCaveat", label: "Polygon date caveat", tier: "UNVERIFIED" },
  { key: "intermediateShape", label: "Intermediate perimeters", tier: "SYNTHETIC" },
  { key: "atmosphere", label: "Smoke and heat", tier: "SYNTHETIC" },
  { key: "crewPositions", label: "Crew positions", tier: "SYNTHETIC" },
  { key: "drones", label: "Drones", tier: "SYNTHETIC" },
];

const TIER_COLOUR = {
  REAL: BAND_COLOUR.SAFE,
  UNVERIFIED: BAND_COLOUR.CAUTION,
  SYNTHETIC: BAND_COLOUR.UNKNOWN,
} as const;

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

/** A circle on the ground, for drawing a recon drone's sensor footprint. */
function circleRing(lat: number, lng: number, radiusM: number, points = 64): number[][] {
  const ring: number[][] = [];
  const mPerDegLng = 111_320 * Math.cos((lat * Math.PI) / 180);
  for (let i = 0; i <= points; i += 1) {
    const a = (i / points) * Math.PI * 2;
    ring.push([lng + (Math.cos(a) * radiusM) / mPerDegLng, lat + (Math.sin(a) * radiusM) / 110_540]);
  }
  return ring;
}

/**
 * Where this firefighter has to get to in order to be clear — measured against
 * their own safe boundary, not a shared muster point.
 *
 * Straight out along their bearing from the ignition point, to the fire edge on
 * that bearing plus their personal safe offset plus a small margin. ALPHA-1
 * clears a few hundred metres out; BRAVO-2 has to go the best part of a
 * kilometre. Same fire, same extraction, two different destinations.
 */
function extractionPointFor(
  member: { lat: number; lng: number; cautionOffsetM: number | null },
  geo: Geo,
  perimeterRadii: number[],
  maxOffsetM: number,
): { lat: number; lng: number } {
  const eastM = (member.lng - geo.originLng) * geo.mPerDegLng;
  const northM = (member.lat - geo.originLat) * geo.mPerDegLat;

  let angle = Math.atan2(eastM, northM);
  if (angle < 0) angle += Math.PI * 2;

  const exact = (angle / (Math.PI * 2)) * perimeterRadii.length;
  const i = Math.floor(exact) % perimeterRadii.length;
  const j = (i + 1) % perimeterRadii.length;
  const f = exact - Math.floor(exact);
  const edge = (perimeterRadii[i] as number) * (1 - f) + (perimeterRadii[j] as number) * f;

  // 150 m of margin so they finish comfortably outside the line, not on it.
  const r = edge + (member.cautionOffsetM ?? maxOffsetM) + 150;

  return {
    lat: geo.originLat + (Math.cos(angle) * r) / geo.mPerDegLat,
    lng: geo.originLng + (Math.sin(angle) * r) / geo.mPerDegLng,
  };
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
  const droneMarkers = useRef<Record<string, maplibregl.Marker>>({});
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
  /** Response drones the commander has launched. Never automatic. */
  const [dispatches, setDispatches] = useState<Dispatch[]>([]);
  const dispatchesRef = useRef<Dispatch[]>([]);
  dispatchesRef.current = dispatches;

  /**
   * Wall clock, ticked only while a response drone is airborne.
   *
   * The flight cannot be driven by the timeline: the timeline is scrubbed, not
   * played, so on a paused timeline a drone dispatched at 14:00 would sit at
   * base forever. Ticking stops as soon as the last drone lands, so an idle map
   * is not re-rendering ten times a second for nothing.
   */
  const [wallMs, setWallMs] = useState<number>(() => Date.now());

  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  /**
   * Latest crew positions, for the marker drag handlers.
   *
   * Those handlers are attached once, when a marker is first created, so they
   * capture whatever `scene` was current at that moment and never see another.
   * A ref is read at drag time instead, which is the difference between moving
   * one crew member and silently resetting all the others.
   */
  const crewRef = useRef<Crew[]>([]);
  crewRef.current = scene?.crew ?? crewRef.current;

  useEffect(() => {
    if (dispatches.length === 0) return;
    const id = setInterval(() => {
      const now = Date.now();
      setWallMs(now);
      const allLanded = dispatches.every(
        (d) =>
          d.arrived === true ||
          now - d.dispatchedAtWallMs >= RESPONSE_FLIGHT_MS + ESCORT_MS,
      );
      if (allLanded) clearInterval(id);
    }, 100);
    return () => clearInterval(id);
  }, [dispatches]);

  /**
   * Response drones as a two-leg mission on the wall clock.
   *
   *   INBOUND   base → where the crew member stood when dispatched
   *   ESCORTING that crew member → the point beyond their own safe contour
   *   CLEAR     standing off at the destination
   */
  const responseDrones = useMemo<(Drone & { phase: string })[]>(() => {
    const base = scene?.droneBase;
    if (base === undefined) return [];

    return dispatches.map((d) => {
      const elapsed = wallMs - d.dispatchedAtWallMs;

      if (elapsed < RESPONSE_FLIGHT_MS) {
        const progress = Math.max(0, elapsed / RESPONSE_FLIGHT_MS);
        return {
          id: d.id,
          kind: "response" as const,
          lat: base.lat + (d.fromLat - base.lat) * progress,
          lng: base.lng + (d.fromLng - base.lng) * progress,
          status: "en_route" as const,
          coverageRadiusM: null,
          assignedTo: d.targetCallsign,
          etaSec: Math.ceil((RESPONSE_FLIGHT_MS - elapsed) / 1000),
          phase: "INBOUND",
        };
      }

      if (d.arrived === true) {
        return {
          id: d.id,
          kind: "response" as const,
          lat: d.toLat,
          lng: d.toLng,
          status: "arrived" as const,
          coverageRadiusM: null,
          assignedTo: d.targetCallsign,
          etaSec: 0,
          phase: "CLEAR",
        };
      }

      const escortProgress = Math.min(1, (elapsed - RESPONSE_FLIGHT_MS) / ESCORT_MS);
      return {
        id: d.id,
        kind: "response" as const,
        lat: d.fromLat + (d.toLat - d.fromLat) * escortProgress,
        lng: d.fromLng + (d.toLng - d.fromLng) * escortProgress,
        status: escortProgress >= 1 ? ("arrived" as const) : ("en_route" as const),
        coverageRadiusM: null,
        assignedTo: d.targetCallsign,
        etaSec:
          escortProgress >= 1
            ? 0
            : Math.ceil((RESPONSE_FLIGHT_MS + ESCORT_MS - elapsed) / 1000),
        phase: escortProgress >= 1 ? "CLEAR" : "ESCORTING",
      };
    });
  }, [dispatches, wallMs, scene?.droneBase]);

  /*
    Walk the escorted crew member out, committing their position to the scene.

    Throttled rather than run every animation frame: each commit re-evaluates
    the real engine at the new position, which is what makes the zone chip step
    DANGER → CAUTION → SAFE as they clear their own contour. Doing that eight
    times over the escort is affordable and legible; doing it a hundred times
    would just queue requests behind each other.
  */
  const lastCommitRef = useRef(0);
  useEffect(() => {
    if (scene === null || dispatches.length === 0) return;
    if (wallMs - lastCommitRef.current < 1_200) return;

    const escorting = dispatches.filter((d) => {
      if (d.arrived === true) return false;
      const elapsed = wallMs - d.dispatchedAtWallMs;
      return elapsed >= RESPONSE_FLIGHT_MS && elapsed <= RESPONSE_FLIGHT_MS + ESCORT_MS + 400;
    });
    if (escorting.length === 0) return;

    /*
      Stop the escort the moment the engine says they are clear.

      The destination is computed at dispatch, when the casualty is usually deep
      inside the fire and their required standoff is at its largest. That
      standoff shrinks as they get out and their heart rate settles, so running
      the full leg overshot badly — one crew member reached SAFE at 906 m and
      was then walked on to 3603 m, out of recon coverage, where the band fell
      back to UNKNOWN. Rescued into a worse reading.

      So the target is a direction, not a contract. Clear is clear.
    */
    const nowSafe = escorting.filter((d) => {
      if (d.arrived === true) return false;
      return crewRef.current.find((c) => c.callsign === d.targetCallsign)?.zone === "SAFE";
    });

    if (nowSafe.length > 0) {
      setDispatches((current) =>
        current.map((d) => {
          if (!nowSafe.some((n) => n.id === d.id)) return d;
          const member = crewRef.current.find((c) => c.callsign === d.targetCallsign);
          return member === undefined
            ? d
            : { ...d, arrived: true, toLat: member.lat, toLng: member.lng };
        }),
      );
    }

    lastCommitRef.current = wallMs;
    setPlacements((current) => {
      const basePositions =
        current ?? crewRef.current.map((c) => ({ callsign: c.callsign, lat: c.lat, lng: c.lng }));
      return basePositions.map((p) => {
        const d = escorting.find((x) => x.targetCallsign === p.callsign);
        if (d === undefined) return p;
        const progress = Math.min(
          1,
          (wallMs - d.dispatchedAtWallMs - RESPONSE_FLIGHT_MS) / ESCORT_MS,
        );
        return {
          ...p,
          lat: d.fromLat + (d.toLat - d.fromLat) * progress,
          lng: d.fromLng + (d.toLng - d.fromLng) * progress,
        };
      });
    });
  }, [wallMs, dispatches, scene]);

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

        /*
          Heavier than a hairline on purpose. A personal safe boundary is a few
          hundred metres, while this fire grows to 13 km across, so at
          whole-fire zoom the three bands are a fraction of a percent of the
          view. The fills alone are invisible there; the dashed edges are what
          actually carries the information, and they widen as you zoom out to
          stay readable.
        */
        m.addLayer({
          id: "zone-caution-line",
          type: "line",
          source: "zone-caution",
          paint: {
            "line-color": ZONE_COLOUR.CAUTION,
            "line-width": ["interpolate", ["linear"], ["zoom"], 9, 3.5, 14, 2],
            "line-dasharray": [3, 2],
          },
        });
        m.addLayer({
          id: "zone-danger-line",
          type: "line",
          source: "zone-danger",
          paint: {
            "line-color": ZONE_COLOUR.DANGER,
            "line-width": ["interpolate", ["linear"], ["zoom"], 9, 3, 14, 1.8],
            "line-dasharray": [3, 2],
          },
        });
        m.addLayer({
          id: "fire-edge",
          type: "line",
          source: "fire",
          paint: { "line-color": "#FF7A1A", "line-width": 2.5 },
        });

        // Recon sensor footprints. Drawn above the risk bands because they
        // explain them: inside a footprint the air data is current, outside it
        // the readings age and confidence falls.
        m.addSource("recon", { type: "geojson", data: EMPTY });
        m.addLayer({
          id: "recon-fill",
          type: "fill",
          source: "recon",
          paint: { "fill-color": RECON_COLOUR, "fill-opacity": 0.07 },
        });
        m.addLayer({
          id: "recon-line",
          type: "line",
          source: "recon",
          paint: {
            "line-color": RECON_COLOUR,
            "line-width": 1.5,
            "line-dasharray": [2, 3],
            "line-opacity": 0.85,
          },
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
      for (const marker of Object.values(droneMarkers.current)) marker.remove();
      markers.current = {};
      droneMarkers.current = {};
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
        marker.on("dragstart", () => {
          // Whoever is being moved becomes the subject of the map. Without this
          // the painted bands still belong to somebody else, so a marker could
          // be dropped into a red band and correctly stay green — green being
          // its own verdict, red being another firefighter's. Both were right
          // and the combination was unreadable.
          setSelected(callsign);
        });
        marker.on("dragend", () => {
          const at = marker!.getLngLat();
          // Freeze the whole crew into explicit placements on first drag, so the
          // server stops falling back to defaults for everyone else.
          //
          // Read positions from a ref, NOT from `scene`. This handler is created
          // once, when the marker first appears, so a captured `scene` is frozen
          // at that render: dragging a second crew member would silently teleport
          // the first one back to where it started.
          setPlacements((current) => {
            const base =
              current ??
              crewRef.current.map((c) => ({
                callsign: c.callsign,
                lat: c.lat,
                lng: c.lng,
              }));
            return base.map((p) =>
              p.callsign === callsign ? { ...p, lat: at.lat, lng: at.lng } : p,
            );
          });
        });

        markers.current[member.callsign] = marker;
      } else {
        marker.setLngLat([member.lng, member.lat]);
      }

      /*
        Only the SUBJECT of the map gets a solid, band-coloured dot.

        The painted bands are one firefighter's. A second crew member's own
        verdict is still shown — it has to be, a commander needs everyone's
        status — but as a hollow ring and a text chip, so it never reads as a
        claim about the ground they are standing on. Otherwise a green dot
        sitting in a red band looks like a contradiction when in fact the two
        marks are answering questions about two different people.
      */
      /*
        THE DOT MUST SIT ON THE ANCHOR POINT.

        Previously the dot and its label were a flex row carrying
        `translate(-50%,-50%)`, which centres the WHOLE ROW on the marker's
        coordinate — so the true position was somewhere in the middle of the
        label text and the dot was drawn roughly half the label's width to the
        left. At the zoom the zones are read at, that offset is several hundred
        metres: enough to show a firefighter standing safely in the caution band
        as though they were inside the fire, with a CAUTION chip that then
        looked like a bug in the engine.

        The element is now a zero-size origin. The dot is absolutely positioned
        and centred on it, and the label hangs off to the right where it cannot
        drag the anchor around.
      */
      const size = isSelected ? 20 : 13;
      const dotStyle = isSelected
        ? `background:${colour};border:4px solid #FFFFFF;box-shadow:0 0 12px ${colour};`
        : `background:rgba(5,6,15,0.55);border:3px solid ${colour};`;

      marker.getElement().innerHTML = `
        <div style="position:relative;width:0;height:0">
          <div style="
            position:absolute;left:0;top:0;transform:translate(-50%,-50%);
            width:${size}px;height:${size}px;border-radius:50%;${dotStyle}
          "></div>
          <div style="
            position:absolute;left:${size / 2 + 5}px;top:0;transform:translateY(-50%);
            background:rgba(5,6,15,${isSelected ? "0.92" : "0.78"});
            padding:2px 5px;border-radius:3px;
            border-left:3px solid ${colour};
            font:${isSelected ? "700 11px" : "600 10px"} ui-monospace,monospace;
            color:#E8ECF8;white-space:nowrap;
            opacity:${isSelected ? 1 : 0.85};
          ">${member.callsign}<span style="color:${colour}"> ${member.zone}</span></div>
        </div>`;
    }

    for (const [callsign, marker] of Object.entries(markers.current)) {
      if (!seen.has(callsign)) {
        marker.remove();
        delete markers.current[callsign];
      }
    }

    /* --- Drones ---------------------------------------------------------- */
    const reconFeatures: GeoJSON.Feature[] = [];
    const seenDrones = new Set<string>();

    for (const drone of [...scene.drones, ...responseDrones]) {
      seenDrones.add(drone.id);

      if (drone.kind === "recon" && drone.coverageRadiusM !== null) {
        reconFeatures.push(
          polygon([circleRing(drone.lat, drone.lng, drone.coverageRadiusM)]),
        );
      }

      const colour = drone.kind === "recon" ? RECON_COLOUR : RESPONSE_COLOUR;
      const glyph = drone.kind === "recon" ? "R" : "▲";
      const phase = (drone as Drone & { phase?: string }).phase;
      const label =
        drone.kind === "recon"
          ? drone.id
          : `${drone.assignedTo ?? "?"} · ${phase ?? ""}${
              drone.status === "en_route" ? ` ${drone.etaSec}s` : ""
            }`;

      let marker = droneMarkers.current[drone.id];
      if (marker === undefined) {
        const el = document.createElement("div");
        el.style.pointerEvents = "none";
        marker = new maplibregl.Marker({ element: el })
          .setLngLat([drone.lng, drone.lat])
          .addTo(m);
        droneMarkers.current[drone.id] = marker;
      } else {
        marker.setLngLat([drone.lng, drone.lat]);
      }

      marker.getElement().innerHTML = `
        <div style="position:relative;width:0;height:0">
          <div style="
            position:absolute;left:0;top:0;transform:translate(-50%,-50%);
            width:16px;height:16px;border-radius:3px;
            background:rgba(5,6,15,0.85);border:2px solid ${colour};
            display:flex;align-items:center;justify-content:center;
            font:700 9px ui-monospace,monospace;color:${colour};
          ">${glyph}</div>
          <div style="
            position:absolute;left:14px;top:0;transform:translateY(-50%);
            background:rgba(5,6,15,0.8);padding:1px 4px;border-radius:3px;
            font:600 9px ui-monospace,monospace;color:${colour};white-space:nowrap;
          ">${label}</div>
        </div>`;
    }

    for (const [id, marker] of Object.entries(droneMarkers.current)) {
      if (!seenDrones.has(id)) {
        marker.remove();
        delete droneMarkers.current[id];
      }
    }

    const reconSource = m.getSource("recon") as maplibregl.GeoJSONSource | undefined;
    reconSource?.setData({ type: "FeatureCollection", features: reconFeatures });
  }, [scene, ready, selected, selectedCrew, responseDrones]);

  /**
   * Frame the selected firefighter closely enough to read their three bands.
   *
   * At whole-fire zoom a few hundred metres of standoff is invisible. This
   * pulls in to a few times their own safe distance, which is the scale the
   * zones actually live at.
   */
  const focusCrew = useCallback(() => {
    const m = map.current;
    if (m === null || selectedCrew === null) return;
    const span = Math.max(1_200, (selectedCrew.cautionOffsetM ?? 1_000) * 3);
    const dLat = span / 110_540;
    const dLng = span / 92_270;
    m.fitBounds(
      [
        [selectedCrew.lng - dLng, selectedCrew.lat - dLat],
        [selectedCrew.lng + dLng, selectedCrew.lat + dLat],
      ],
      { duration: 700 },
    );
  }, [selectedCrew]);

  /** Pull back out to the whole burn area. */
  const showWholeFire = useCallback(() => {
    const m = map.current;
    if (m === null || scene === null) return;
    const ring = ringFrom(scene.perimeterRadii, 0, scene.geo);
    const bounds = new maplibregl.LngLatBounds();
    for (const point of ring) bounds.extend([point[0] as number, point[1] as number]);
    m.fitBounds(bounds, { padding: 60, duration: 700 });
  }, [scene]);

  const start = scene?.timelineStartMs ?? Date.parse("2025-01-07T18:30:00Z");
  const end = scene?.timelineEndMs ?? Date.parse("2025-01-31T18:00:00Z");
  const current = atMs ?? scene?.atMs ?? start;

  /** A response drone already launched for this crew member, if any. */
  const dispatchFor = (callsign: string): Dispatch | undefined =>
    dispatches.find((d) => d.targetCallsign === callsign);

  const droneFor = (callsign: string): (Drone & { phase: string }) | undefined =>
    responseDrones.find((d) => d.assignedTo === callsign);

  /*
    Dispatch is a COMMANDER ACTION and never automatic.

    Valoris does not withdraw anyone and does not launch anything on its own. It
    can show that a crew member is falling back and put dispatch one click away;
    deciding to send the drone stays with the person accountable for it.
  */
  const dispatchTo = (member: Crew) => {
    if (scene === null) return;
    const now = Date.now();
    const destination = extractionPointFor(
      member,
      scene.geo,
      scene.perimeterRadii,
      scene.maxOffsetM,
    );
    setWallMs(now);
    setDispatches((current) => [
      ...current.filter((d) => d.targetCallsign !== member.callsign),
      {
        id: `RESP-${member.callsign}`,
        targetCallsign: member.callsign,
        fromLat: member.lat,
        fromLng: member.lng,
        toLat: destination.lat,
        toLng: destination.lng,
        dispatchedAtWallMs: now,
      },
    ]);
  };

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

          <div className="absolute right-2 top-2 z-10 flex gap-1">
            <button
              onClick={focusCrew}
              className="rounded px-2 py-1 text-[11px] font-bold"
              style={{
                background: "#1E2650",
                border: `1px solid ${COLOURS.text}`,
                color: COLOURS.text,
              }}
            >
              ZOOM TO {selected}
            </button>
            <button
              onClick={showWholeFire}
              className="rounded px-2 py-1 text-[11px] font-semibold"
              style={{
                background: "rgba(5,6,15,0.85)",
                border: `1px solid ${COLOURS.border}`,
                color: COLOURS.text,
              }}
            >
              WHOLE FIRE
            </button>
            <button
              onClick={() => setBasemapOn((v) => !v)}
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
            One compact strip instead of the old paragraph block, which covered
            most of the map on anything narrower than a wide desktop. The
            explanations it carried now live in the "What here is real?"
            disclosure; all that has to be on the map is WHOSE zones these are,
            because that is not inferable from the bands themselves.
          */}
          <div
            className="pointer-events-none absolute bottom-2 left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded px-2.5 py-1 font-mono text-[11px]"
            style={{
              background: "rgba(5,6,15,0.9)",
              border: `1px solid ${COLOURS.border}`,
              color: COLOURS.muted,
            }}
          >
            <span style={{ color: COLOURS.muted }}>ZONES FOR </span>
            <span style={{ color: COLOURS.text, fontWeight: 700 }}>{selected}</span>
            <span style={{ color: ZONE_COLOUR.DANGER }}> ● danger</span>
            <span style={{ color: ZONE_COLOUR.CAUTION }}> ● caution</span>
            <span style={{ color: ZONE_COLOUR.SAFE }}> ● safe</span>
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

                  <div className="mt-1 flex items-center gap-2">
                    <span
                      className="rounded px-1.5 py-0.5 text-[9px] font-bold"
                      style={{
                        color: member.reconCoverage ? RECON_COLOUR : COLOURS.muted,
                        border: `1px solid ${member.reconCoverage ? RECON_COLOUR : COLOURS.border}`,
                      }}
                      title={
                        member.reconCoverage
                          ? "A recon drone is refreshing the air picture here, so CO and PM2.5 are current."
                          : "No recon overhead. Air readings age out, so confidence is reduced."
                      }
                    >
                      {member.reconCoverage ? "RECON" : "NO RECON"}
                    </span>
                    <span className="text-[9px]" style={{ color: COLOURS.muted }}>
                      confidence {member.confidence}
                    </span>

                    {dispatchFor(member.callsign) === undefined ? (
                      <button
                        className="ml-auto rounded px-2 py-0.5 text-[9px] font-bold"
                        style={{
                          border: `1px solid ${RESPONSE_COLOUR}`,
                          color: RESPONSE_COLOUR,
                        }}
                        onClick={(event) => {
                          event.stopPropagation();
                          dispatchTo(member);
                        }}
                      >
                        DISPATCH DRONE
                      </button>
                    ) : (
                      <span
                        className="ml-auto rounded px-2 py-0.5 text-[9px] font-bold"
                        style={{ color: RESPONSE_COLOUR, border: `1px solid ${RESPONSE_COLOUR}` }}
                      >
                        {(() => {
                          const d = droneFor(member.callsign);
                          if (d === undefined) return "DISPATCHED";
                          const phase = (d as Drone & { phase?: string }).phase;
                          if (phase === "INBOUND") return `INBOUND ${d.etaSec}s`;
                          if (phase === "ESCORTING") return `ESCORTING ${d.etaSec}s`;
                          return "CLEAR";
                        })()}
                      </span>
                    )}
                  </div>
                </button>
              );
            })
          )}

          {/*
            Provenance, shown rather than buried. The synthetic parts of this
            picture are the first thing a reviewer should be told, not something
            they have to catch — and the parts that ARE real are more convincing
            when they sit next to an honest account of the parts that are not.
          */}
          {scene !== null && (
            <details className="px-3 py-2" style={{ borderTop: `1px solid ${COLOURS.border}` }}>
              <summary
                className="cursor-pointer text-[11px] font-bold"
                style={{ color: COLOURS.text }}
              >
                What here is real? ({PROVENANCE_ORDER.filter((p) => p.tier === "REAL").length} real
                · {PROVENANCE_ORDER.filter((p) => p.tier === "UNVERIFIED").length} unverified ·{" "}
                {PROVENANCE_ORDER.filter((p) => p.tier === "SYNTHETIC").length} synthetic)
              </summary>

              <div className="mt-2 space-y-1.5">
                {PROVENANCE_ORDER.map((row) => {
                  const text = scene.provenance[row.key];
                  if (text === undefined) return null;
                  return (
                    <div key={row.key} className="text-[10px] leading-relaxed">
                      <span
                        className="mr-1 rounded px-1 py-0.5 font-bold"
                        style={{
                          color: TIER_COLOUR[row.tier],
                          border: `1px solid ${TIER_COLOUR[row.tier]}`,
                        }}
                      >
                        {row.tier}
                      </span>
                      <span style={{ color: COLOURS.text }}>{row.label}</span>
                      <span style={{ color: COLOURS.muted }}> — {text}</span>
                    </div>
                  );
                })}
              </div>

              <div
                className="mt-2 pt-2 font-mono text-[10px]"
                style={{ borderTop: `1px solid ${COLOURS.border}`, color: COLOURS.muted }}
              >
                <div style={{ color: COLOURS.text }}>Interagency incident record</div>
                {scene.incidentRecord.uniqueFireId} · {scene.incidentRecord.mapMethod} ·{" "}
                {scene.incidentRecord.finalAcres?.toLocaleString()} acres ·{" "}
                {scene.incidentRecord.percentContained}% contained
                <br />
                discovered {String(scene.incidentRecord.discoveryUtc).slice(0, 16)}Z · record
                updated {String(scene.incidentRecord.recordUpdatedUtc).slice(0, 16)}Z
                <br />
                fuel: {scene.incidentRecord.primaryFuel} · unit:{" "}
                {scene.incidentRecord.protectingUnit}
              </div>
            </details>
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
