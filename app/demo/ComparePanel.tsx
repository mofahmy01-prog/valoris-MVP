"use client";

import { useEffect, useState } from "react";

import { asBand, BAND_COLOUR, BAND_GLYPH, COLOURS } from "./theme";

type CompareRow = {
  callsign: string;
  age: number;
  fitness: string;
  conditions: string;
  hrMaxBpm: number;
  hrPercentOfMax: number;
  score: number;
  band: string;
  topDriver: string;
};

type CompareResponse = {
  severityIndex: number;
  severityLabel: string;
  steps: string[];
  conditions: {
    hrBpm: number;
    spo2Pct: number;
    ambientTempC: number;
    coPpm: number;
    pm25UgM3: number;
    fireFrontM: number;
    scbaPressurePct: number;
  };
  rows: CompareRow[];
};

export function ComparePanel() {
  const [severity, setSeverity] = useState(2);
  const [data, setData] = useState<CompareResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/demo/compare?severity=${severity}`)
      .then((r) => r.json())
      .then((json: CompareResponse) => {
        if (!cancelled) setData(json);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [severity]);

  const bandsPresent = new Set((data?.rows ?? []).map((r) => r.band));

  return (
    <div className="flex h-full flex-col overflow-y-auto p-3">
      <h2 className="text-lg font-bold" style={{ color: COLOURS.text }}>
        Identical sensor readings. Six different risk scores.
      </h2>
      <p className="mt-1 text-xs leading-relaxed" style={{ color: COLOURS.muted }}>
        Every threshold is calibrated to the individual — age-adjusted maximum heart
        rate, fitness, declared conditions, previous shift hours, cumulative exposure.
      </p>

      {data !== null && (
        <div
          className="mt-3 rounded p-2 font-mono text-[11px]"
          style={{ background: COLOURS.background, border: `1px solid ${COLOURS.border}`, color: COLOURS.muted }}
        >
          Everyone: HR {data.conditions.hrBpm} · SpO2 {data.conditions.spo2Pct}% ·
          ambient {data.conditions.ambientTempC}°C · CO {data.conditions.coPpm} ppm ·
          PM2.5 {data.conditions.pm25UgM3} · fire front {data.conditions.fireFrontM} m ·
          SCBA {data.conditions.scbaPressurePct}%
        </div>
      )}

      <div className="mt-4">
        <div className="flex items-center justify-between">
          <label className="text-xs font-semibold uppercase tracking-wide" style={{ color: COLOURS.muted }}>
            Severity
          </label>
          <span className="font-mono text-sm font-bold" style={{ color: COLOURS.text }}>
            {data?.severityLabel ?? "…"}
          </span>
        </div>
        <input
          type="range"
          min={0}
          max={5}
          step={1}
          value={severity}
          onChange={(e) => setSeverity(Number(e.target.value))}
          className="mt-2 w-full accent-orange-500"
        />
        <div className="flex justify-between text-[10px]" style={{ color: COLOURS.muted }}>
          {(data?.steps ?? ["benign", "light", "moderate", "heavy", "severe", "extreme"]).map(
            (s) => (
              <span key={s}>{s}</span>
            ),
          )}
        </div>
      </div>

      <table className="mt-4 w-full border-collapse text-left text-xs">
        <thead>
          <tr style={{ color: COLOURS.muted }}>
            <th className="py-1 pr-2 font-semibold">Callsign</th>
            <th className="py-1 pr-2 font-semibold">Age</th>
            <th className="py-1 pr-2 font-semibold">Conditions</th>
            <th className="py-1 pr-2 font-semibold">HR % max</th>
            <th className="py-1 pr-2 text-right font-semibold">Score</th>
            <th className="py-1 font-semibold">Band</th>
          </tr>
        </thead>
        <tbody>
          {(data?.rows ?? []).map((r) => {
            const band = asBand(r.band);
            const colour = BAND_COLOUR[band];
            return (
              <tr key={r.callsign} style={{ borderTop: `1px solid ${COLOURS.border}` }}>
                <td className="py-1.5 pr-2 font-mono font-bold" style={{ color: COLOURS.text }}>
                  {r.callsign}
                </td>
                <td className="py-1.5 pr-2 tabular-nums" style={{ color: COLOURS.muted }}>
                  {r.age}
                </td>
                <td className="py-1.5 pr-2" style={{ color: COLOURS.muted }}>
                  {r.conditions}
                </td>
                <td className="py-1.5 pr-2 font-mono tabular-nums" style={{ color: COLOURS.text }}>
                  {r.hrPercentOfMax}% of {r.hrMaxBpm}
                </td>
                <td
                  className="py-1.5 pr-2 text-right font-mono text-base font-bold tabular-nums"
                  style={{ color: colour }}
                >
                  {r.score.toFixed(1)}
                </td>
                <td className="py-1.5 font-mono font-bold" style={{ color: colour }}>
                  {BAND_GLYPH[band]} {band}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {bandsPresent.size > 1 && (
        <div
          className="mt-3 rounded p-2 text-xs font-semibold"
          style={{ background: "#1A1206", border: `1px solid ${BAND_COLOUR.HIGH}`, color: BAND_COLOUR.CAUTION }}
        >
          The crew has separated into {bandsPresent.size} different bands under
          identical conditions.
        </div>
      )}

      <p className="mt-3 text-[11px] leading-relaxed" style={{ color: COLOURS.muted }}>
        Computed by the same deterministic engine that runs the live incident. Same
        input plus same config always produces the same output. Every threshold is
        illustrative and unreviewed.
      </p>
    </div>
  );
}
