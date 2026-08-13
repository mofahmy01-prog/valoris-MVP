"use client";

import { asBand, BAND_COLOUR, BAND_GLYPH, COLOURS } from "./theme";
import type { SnapshotFirefighter } from "./types";

function Bar({ label, value }: { label: string; value: number }) {
  return (
    <div className="mt-2">
      <div className="flex justify-between text-[11px]" style={{ color: COLOURS.muted }}>
        <span>{label}</span>
        <span className="font-mono tabular-nums" style={{ color: COLOURS.text }}>
          {value.toFixed(1)}
        </span>
      </div>
      <div className="mt-1 h-2 w-full rounded" style={{ background: COLOURS.border }}>
        <div
          className="h-2 rounded"
          style={{
            width: `${Math.max(0, Math.min(100, value))}%`,
            background:
              value >= 75 ? BAND_COLOUR.CRITICAL : value >= 50 ? BAND_COLOUR.HIGH : value >= 25 ? BAND_COLOUR.CAUTION : BAND_COLOUR.SAFE,
          }}
        />
      </div>
    </div>
  );
}

export function DetailPanel({
  firefighter,
  onClose,
}: {
  firefighter: SnapshotFirefighter;
  onClose: () => void;
}) {
  const band = asBand(firefighter.risk?.band);
  const colour = BAND_COLOUR[band];
  const r = firefighter.risk;

  return (
    <div
      className="flex h-full flex-col overflow-y-auto"
      style={{ background: COLOURS.panel, borderLeft: `2px solid ${colour}` }}
    >
      <div
        className="flex items-start justify-between p-3"
        style={{ borderBottom: `1px solid ${COLOURS.border}` }}
      >
        <div>
          <div className="font-mono text-xl font-bold" style={{ color: COLOURS.text }}>
            {firefighter.callsign}
          </div>
          <div className="text-xs" style={{ color: COLOURS.muted }}>
            {firefighter.profile.ageYears}y · {firefighter.profile.fitness} fitness ·{" "}
            {firefighter.profile.conditions.length === 0
              ? "no declared conditions"
              : firefighter.profile.conditions.join(", ")}
          </div>
          <div className="text-xs" style={{ color: COLOURS.muted }}>
            resp {firefighter.profile.respiratoryRisk} · heat tolerance{" "}
            {firefighter.profile.heatTolerance} · prev shift{" "}
            {firefighter.profile.prevShiftHours}h
          </div>
        </div>
        <button
          onClick={onClose}
          className="rounded px-2 py-1 text-sm"
          style={{ color: COLOURS.muted, border: `1px solid ${COLOURS.border}` }}
        >
          close
        </button>
      </div>

      {r === null ? (
        <div className="p-4 text-sm" style={{ color: COLOURS.muted }}>
          {firefighter.reason ?? "No assessment yet."}
        </div>
      ) : (
        <div className="p-3">
          <div className="flex items-baseline gap-3">
            <span
              className="font-mono text-5xl font-bold tabular-nums"
              style={{ color: colour }}
            >
              {r.score.toFixed(1)}
            </span>
            <span className="font-mono text-xl font-bold" style={{ color: colour }}>
              {BAND_GLYPH[band]} {band}
            </span>
          </div>

          {r.hardOverride && (
            <div
              className="mt-2 rounded p-2 text-xs font-bold"
              style={{ background: "#2A0A10", border: `1px solid ${BAND_COLOUR.CRITICAL}`, color: BAND_COLOUR.CRITICAL }}
            >
              HARD OVERRIDE — bypasses the composite score
              <ul className="mt-1 list-disc pl-4 font-normal">
                {r.hardOverrideReasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="mt-4">
            <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: COLOURS.muted }}>
              Subscores
            </div>
            <Bar label="Physiological (40%)" value={r.subscores.physiological} />
            <Bar label="Environmental (30%)" value={r.subscores.environmental} />
            <Bar label="Proximity (20%)" value={r.subscores.proximity} />
            <Bar label="Profile (10%)" value={r.subscores.profile} />
          </div>

          <div className="mt-4">
            <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: COLOURS.muted }}>
              Ranked drivers
            </div>
            <ol className="mt-1 list-decimal pl-4 text-xs" style={{ color: COLOURS.text }}>
              {r.topDrivers.map((d) => (
                <li key={d} className="mt-0.5">
                  {d}
                </li>
              ))}
            </ol>
          </div>

          {firefighter.physiology !== null && (
            <div className="mt-4">
              <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: COLOURS.muted }}>
                Modelled physiology
              </div>
              <div className="mt-1 font-mono text-xs" style={{ color: COLOURS.text }}>
                est. core {firefighter.physiology.coreTempC?.toFixed(2) ?? "—"} °C
                {firefighter.physiology.coreTempSdC !== null &&
                  ` ± ${firefighter.physiology.coreTempSdC.toFixed(2)}`}
                {" (estimated, not measured)"}
                <br />
                fatigue {firefighter.physiology.fatiguePct?.toFixed(1) ?? "—"}% · HRR{" "}
                {firefighter.physiology.hrrFraction === null
                  ? "—"
                  : `${Math.round(firefighter.physiology.hrrFraction * 100)}%`}
                <br />
                allowable duration{" "}
                {firefighter.physiology.dlimMin === null
                  ? "beyond horizon"
                  : `${firefighter.physiology.dlimMin} min`}{" "}
                · COHb {firefighter.physiology.cohbPct?.toFixed(2) ?? "—"}%
                {firefighter.latest?.glucoseMmolL !== null &&
                  firefighter.latest !== null && (
                    <>
                      <br />
                      glucose {firefighter.latest.glucoseMmolL?.toFixed(1)} mmol/L
                      (lag-corrected)
                    </>
                  )}
              </div>
            </div>
          )}

          <div className="mt-4">
            <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: COLOURS.muted }}>
              Data quality
            </div>
            <div className="mt-1 text-xs" style={{ color: COLOURS.text }}>
              confidence{" "}
              <span style={{ color: r.dataQuality.confidence === "low" ? BAND_COLOUR.HIGH : COLOURS.text }}>
                {r.dataQuality.confidence}
              </span>
              {" · oldest reading "}
              {r.dataQuality.oldestReadingAgeSec}s
            </div>
            {r.dataQuality.missingInputs.length > 0 && (
              <div className="mt-1 text-xs font-semibold" style={{ color: BAND_COLOUR.UNKNOWN }}>
                MISSING: {r.dataQuality.missingInputs.join(", ")}
              </div>
            )}
            {r.dataQuality.staleInputs.length > 0 && (
              <div className="mt-1 text-xs" style={{ color: BAND_COLOUR.CAUTION }}>
                stale: {r.dataQuality.staleInputs.join(", ")}
              </div>
            )}
          </div>

          <div className="mt-4">
            <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: COLOURS.muted }}>
              Explanation
            </div>
            <p className="mt-1 text-xs leading-relaxed" style={{ color: COLOURS.text }}>
              {r.explanation}
            </p>
          </div>

          <div className="mt-4 text-[10px]" style={{ color: COLOURS.muted }}>
            model {r.modelVersion} · config {r.configHash}
          </div>
        </div>
      )}
    </div>
  );
}
