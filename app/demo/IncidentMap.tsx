"use client";

/**
 * Abstract operational map — SVG on a dark ground.
 *
 * Deliberately not MapLibre. A basemap needs a network round trip, and a live
 * demo that depends on tiles loading is a demo with an extra way to fail. The
 * geometry here is the real geometry: crew positions and the fire perimeter come
 * straight from the snapshot, projected locally to metres.
 */

import { asBand, BAND_COLOUR, COLOURS, presentation } from "./theme";
import type { Snapshot } from "./types";

const VIEW = 1000;
/** Half-width of the view, in metres. */
const HALF_SPAN_M = 1600;

function project(
  lat: number,
  lng: number,
  centreLat: number,
  centreLng: number,
): { x: number; y: number } {
  const EARTH_RADIUS_M = 6_371_008.8;
  const latRad = (centreLat * Math.PI) / 180;
  const eastM = ((lng - centreLng) * Math.PI / 180) * Math.cos(latRad) * EARTH_RADIUS_M;
  const northM = ((lat - centreLat) * Math.PI / 180) * EARTH_RADIUS_M;
  const scale = VIEW / (HALF_SPAN_M * 2);
  return { x: VIEW / 2 + eastM * scale, y: VIEW / 2 - northM * scale };
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
  const centreLat = snapshot?.incident.centroidLat ?? 34.0459;
  const centreLng = snapshot?.incident.centroidLng ?? -118.5426;
  const perimeter = snapshot?.fireFront.perimeter ?? [];

  const firePoints = perimeter
    .map((p) => {
      const { x, y } = project(p.lat, p.lng, centreLat, centreLng);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  // Safe zone: fixed muster point north-west of the incident centre.
  const safeZone = project(
    centreLat + 0.0063,
    centreLng - 0.0098,
    centreLat,
    centreLng,
  );

  return (
    <div
      className="relative h-full w-full overflow-hidden rounded"
      style={{ background: COLOURS.background, border: `1px solid ${COLOURS.border}` }}
    >
      <svg viewBox={`0 0 ${VIEW} ${VIEW}`} className="h-full w-full">
        <defs>
          <pattern id="grid" width="50" height="50" patternUnits="userSpaceOnUse">
            <path
              d="M 50 0 L 0 0 0 50"
              fill="none"
              stroke={COLOURS.border}
              strokeWidth="1"
              opacity="0.5"
            />
          </pattern>
        </defs>
        <rect width={VIEW} height={VIEW} fill="url(#grid)" />

        {/* Fire perimeter */}
        {firePoints !== "" && (
          <polygon
            points={firePoints}
            fill="#CC1020"
            fillOpacity="0.28"
            stroke="#F05A00"
            strokeWidth="2.5"
          />
        )}

        {/* Safe zone */}
        <g>
          <circle
            cx={safeZone.x}
            cy={safeZone.y}
            r="58"
            fill="none"
            stroke="#00C878"
            strokeWidth="2.5"
            strokeDasharray="8 6"
          />
          <text
            x={safeZone.x}
            y={safeZone.y + 4}
            textAnchor="middle"
            fontSize="17"
            fill="#00C878"
            fontFamily="ui-monospace, monospace"
          >
            SAFE ZONE
          </text>
        </g>

        {/* Crew */}
        {(snapshot?.firefighters ?? []).map((f) => {
          const band = asBand(f.risk?.band);
          const p = presentation(band, f.risk?.dataQuality.missingInputs);
          const dataLost = p.greyed;
          const colour = p.colour;
          if (f.latest === null) return null;
          const marker = project(f.latest.lat, f.latest.lng, centreLat, centreLng);
          const isSelected = selected === f.callsign;
          return (
            <g
              key={f.callsign}
              onClick={() => onSelect(f.callsign)}
              style={{ cursor: "pointer" }}
            >
              {isSelected && (
                <circle cx={marker.x} cy={marker.y} r="30" fill="none" stroke={COLOURS.text} strokeWidth="2" />
              )}
              <circle
                cx={marker.x}
                cy={marker.y}
                r="19"
                fill={colour}
                fillOpacity={dataLost ? 0.3 : 0.95}
                stroke={colour}
                strokeWidth="3"
                strokeDasharray={dataLost ? "5 4" : undefined}
              />
              <text
                x={marker.x}
                y={marker.y + 7}
                textAnchor="middle"
                fontSize="20"
                fontWeight="700"
                fill={dataLost ? COLOURS.text : "#05060F"}
                fontFamily="ui-monospace, monospace"
              >
                {p.glyph}
              </text>
              {p.badge !== null && (
                <text
                  x={marker.x + 26}
                  y={marker.y + 24}
                  fontSize="14"
                  fill={BAND_COLOUR.UNKNOWN}
                  fontFamily="ui-monospace, monospace"
                >
                  {p.badge}
                </text>
              )}
              <text
                x={marker.x + 26}
                y={marker.y + 6}
                fontSize="19"
                fill={COLOURS.text}
                fontFamily="ui-monospace, monospace"
              >
                {f.callsign}
              </text>
            </g>
          );
        })}
      </svg>

      <div
        className="absolute bottom-2 left-2 rounded px-2 py-1 text-[11px]"
        style={{ background: "rgba(5,6,15,0.85)", color: COLOURS.muted }}
      >
        {snapshot?.fireFront.providerLabel ?? "no fire front"} · abstract view, not a
        geographic basemap
      </div>
    </div>
  );
}
