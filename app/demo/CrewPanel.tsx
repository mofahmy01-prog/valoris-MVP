"use client";

import { asBand, BAND_COLOUR, BAND_ORDER, COLOURS, presentation } from "./theme";
import type { Snapshot, SnapshotFirefighter } from "./types";

function agoSeconds(iso: string | null, generatedAtUtc: string): number | null {
  if (iso === null) return null;
  return Math.max(0, Math.round((Date.parse(generatedAtUtc) - Date.parse(iso)) / 1000));
}

export function CrewPanel({
  snapshot,
  selected,
  onSelect,
}: {
  snapshot: Snapshot | null;
  selected: string | null;
  onSelect: (callsign: string) => void;
}) {
  const crew: SnapshotFirefighter[] = [...(snapshot?.firefighters ?? [])].sort(
    (a, b) => {
      const byBand = BAND_ORDER[asBand(a.risk?.band)] - BAND_ORDER[asBand(b.risk?.band)];
      if (byBand !== 0) return byBand;
      return (b.risk?.score ?? 0) - (a.risk?.score ?? 0);
    },
  );

  if (crew.length === 0) {
    return (
      <div className="p-4 text-sm" style={{ color: COLOURS.muted }}>
        No crew yet. Press PLAY to start the incident.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 overflow-y-auto p-2">
      {crew.map((f) => {
        const band = asBand(f.risk?.band);
        const p = presentation(band, f.risk?.dataQuality.missingInputs);
        const dataLost = p.greyed;
        const colour = p.colour;
        const hrMax = 220 - f.profile.ageYears;
        const hr = f.latest?.hrBpm ?? null;
        const ago = agoSeconds(f.latestObservationAtUtc, snapshot?.generatedAtUtc ?? "");
        const isSelected = selected === f.callsign;

        return (
          <button
            key={f.callsign}
            onClick={() => onSelect(f.callsign)}
            className="w-full rounded p-3 text-left transition-colors"
            style={{
              background: dataLost ? "#14161F" : isSelected ? "#131836" : COLOURS.panel,
              border: `2px ${dataLost ? "dashed" : "solid"} ${colour}`,
              borderLeftWidth: "6px",
              opacity: dataLost ? 0.97 : 1,
            }}
          >
            <div className="flex items-baseline justify-between">
              <span
                className="font-mono text-base font-bold tracking-wide"
                style={{ color: COLOURS.text }}
              >
                {f.callsign}
              </span>
              <span className="font-mono text-sm font-bold" style={{ color: colour }}>
                {p.glyph} {p.label}
              </span>
            </div>

            {p.badge !== null && (
              <div
                className="mt-1 inline-block rounded px-1.5 py-0.5 text-[10px] font-bold"
                style={{
                  background: BAND_COLOUR.UNKNOWN,
                  color: "#05060F",
                }}
              >
                {p.badge}
              </div>
            )}

            <div className="mt-1 flex items-baseline gap-3">
              {dataLost ? (
                <>
                  <span
                    className="font-mono text-3xl font-bold"
                    style={{ color: BAND_COLOUR.UNKNOWN }}
                  >
                    ?
                  </span>
                  <span
                    className="text-xs font-semibold"
                    style={{ color: BAND_COLOUR.UNKNOWN }}
                  >
                    no reliable score · composite still reads {band} {f.risk?.score.toFixed(1)}
                  </span>
                </>
              ) : (
                <>
                  <span
                    className="font-mono text-3xl font-bold tabular-nums"
                    style={{ color: colour }}
                  >
                    {f.risk === null ? "—" : f.risk.score.toFixed(1)}
                  </span>
                  <span className="text-xs" style={{ color: COLOURS.muted }}>
                    {f.profile.ageYears}y · {f.profile.fitness}
                  </span>
                </>
              )}
            </div>

            <div className="mt-1 font-mono text-xs" style={{ color: COLOURS.text }}>
              {hr === null ? (
                <span style={{ color: BAND_COLOUR.UNKNOWN }}>HR ? unavailable</span>
              ) : (
                <>
                  HR {Math.round(hr)} ({Math.round((hr / hrMax) * 100)}% of max {hrMax})
                </>
              )}
              {" · "}
              SCBA {f.latest?.scbaPressurePct === null || f.latest === null ? "?" : `${Math.round(f.latest.scbaPressurePct)}%`}
              {" · "}
              {f.latest === null ? "—" : `${Math.round(f.latest.timeOnTaskMin)} min`}
            </div>

            {f.risk !== null && f.risk.topDrivers.length > 0 && (
              <div
                className="mt-1 truncate text-xs"
                style={{ color: COLOURS.muted }}
                title={f.risk.topDrivers[0]}
              >
                {f.risk.topDrivers[0]}
              </div>
            )}

            <div className="mt-1 text-[11px]" style={{ color: COLOURS.muted }}>
              confidence {f.risk?.dataQuality.confidence ?? "—"}
              {ago !== null && ` · updated ${ago}s ago`}
              {f.risk !== null && f.risk.dataQuality.missingInputs.length > 0 && (
                <span style={{ color: BAND_COLOUR.UNKNOWN }}>
                  {" "}
                  · missing: {f.risk.dataQuality.missingInputs.join(", ")}
                </span>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}
