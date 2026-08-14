"use client";

/**
 * Live inputs strip — what is going INTO the engine, above the map.
 *
 * The demo point: these numbers are the feed, the map and the crew bands are
 * what the engine makes of them. Raw PurpleAir is shown next to the corrected
 * value so the correction is visible rather than asserted.
 */

import { BAND_COLOUR, COLOURS } from "./theme";
import type { SimStatus, Snapshot } from "./types";

function Metric({
  label,
  value,
  unit,
  tone,
  sub,
}: {
  label: string;
  value: string;
  unit?: string;
  tone?: string;
  sub?: string;
}) {
  return (
    <div
      className="min-w-0 flex-1 rounded px-2 py-1"
      style={{ background: COLOURS.background, border: `1px solid ${COLOURS.border}` }}
    >
      <div className="truncate text-[10px] uppercase tracking-wide" style={{ color: COLOURS.muted }}>
        {label}
      </div>
      <div className="font-mono text-sm font-bold tabular-nums" style={{ color: tone ?? COLOURS.text }}>
        {value}
        {unit !== undefined && <span className="ml-0.5 text-[10px] font-normal">{unit}</span>}
      </div>
      {sub !== undefined && (
        <div className="truncate text-[10px]" style={{ color: COLOURS.muted }}>
          {sub}
        </div>
      )}
    </div>
  );
}

export function InputsPanel({
  snapshot,
  status,
}: {
  snapshot: Snapshot | null;
  status: SimStatus | null;
}) {
  // Take the worst-exposed firefighter's atmosphere as the incident-level feed.
  const withData = (snapshot?.firefighters ?? []).filter((f) => f.latest !== null);
  const lead =
    withData.length === 0
      ? null
      : withData.reduce((worst, f) =>
          (f.latest?.coPpm ?? 0) > (worst.latest?.coPpm ?? 0) ? f : worst,
        );
  const l = lead?.latest ?? null;

  const nearest = withData.reduce<number | null>((min, f) => {
    const d = f.latest?.distanceToFireFrontM ?? null;
    if (d === null) return min;
    return min === null || d < min ? d : min;
  }, null);

  const coTone =
    l === null || l.coPpm === null
      ? COLOURS.muted
      : l.coPpm > 100
        ? BAND_COLOUR.CRITICAL
        : l.coPpm > 35
          ? BAND_COLOUR.CAUTION
          : COLOURS.text;

  return (
    <div className="flex flex-wrap items-stretch gap-1.5 px-2 py-1.5">
      <Metric
        label="Incident clock"
        value={status === null ? "—" : `T+${status.incidentMinutes}`}
        unit="min"
        sub={status?.running === true ? `running ${status.speed}x` : "paused"}
      />
      <Metric
        label="Wind"
        value={status === null ? "—" : `${Math.round(status.windSpeedMs ?? 0)}`}
        unit="m/s"
        tone={status?.windShiftActive === true ? BAND_COLOUR.HIGH : undefined}
        sub={status?.windShiftActive === true ? "SHIFTED — driving NE" : `bearing ${status?.windDirDeg ?? "—"}°`}
      />
      <Metric
        label="Ambient"
        value={l?.ambientTempC === null || l === null ? "—" : `${Math.round(l.ambientTempC)}`}
        unit="°C"
      />
      <Metric label="CO" value={l?.coPpm === null || l === null ? "?" : `${Math.round(l.coPpm)}`} unit="ppm" tone={coTone} />
      <Metric
        label="PM2.5 corrected"
        value={l?.pm25UgM3 === null || l === null ? "?" : `${Math.round(l.pm25UgM3)}`}
        unit="µg/m³"
        sub={l?.pm25RawUgM3 === null || l === null ? undefined : `raw ${Math.round(l.pm25RawUgM3)} → EPA corrected`}
      />
      <Metric
        label="Nearest crew to front"
        value={nearest === null ? "—" : `${Math.round(nearest)}`}
        unit="m"
        tone={nearest !== null && nearest < 150 ? BAND_COLOUR.CRITICAL : undefined}
      />
      <Metric
        label="Data tier"
        value={snapshot?.provenance.dataTierSummary ?? "—"}
        sub="C = simulated"
      />
    </div>
  );
}
