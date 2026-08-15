"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { ComparePanel } from "./ComparePanel";
import { CrewPanel } from "./CrewPanel";
import { DetailPanel } from "./DetailPanel";
import { IncidentMap } from "./IncidentMap";
import { InputsPanel } from "./InputsPanel";
import { BAND_COLOUR, COLOURS } from "./theme";
import type { SimStatus, Snapshot } from "./types";

const POLL_MS = 2000;

const KILLABLE = [
  { key: "hrBpm", label: "Heart rate" },
  { key: "spo2Pct", label: "SpO2" },
  { key: "coPpm", label: "CO" },
  { key: "pm25UgM3", label: "PM2.5" },
  { key: "scbaPressurePct", label: "SCBA pressure" },
];

async function sim(body: Record<string, unknown>): Promise<SimStatus | null> {
  try {
    const r = await fetch("/api/sim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return (await r.json()) as SimStatus;
  } catch {
    return null;
  }
}

export function DemoClient() {
  const [status, setStatus] = useState<SimStatus | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [view, setView] = useState<"crew" | "compare">("crew");
  const [selected, setSelected] = useState<string | null>(null);
  const [killOpen, setKillOpen] = useState(false);
  const incidentIdRef = useRef<string | null>(null);

  // Poll, not SSE: one fewer thing that can break live.
  useEffect(() => {
    let cancelled = false;

    const poll = async (): Promise<void> => {
      try {
        const s = (await (await fetch("/api/sim")).json()) as SimStatus;
        if (cancelled) return;
        setStatus(s);
        incidentIdRef.current = s.incidentId;
        if (s.incidentId !== null) {
          const snap = (await (
            await fetch(`/api/incidents/${s.incidentId}/snapshot`)
          ).json()) as Snapshot;
          if (!cancelled) setSnapshot(snap);
        }
      } catch {
        // A dropped poll is not fatal; the next one will land.
      }
    };

    void poll();
    const timer = setInterval(() => void poll(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const act = useCallback(async (body: Record<string, unknown>) => {
    const s = await sim(body);
    if (s !== null) setStatus(s);
  }, []);

  const selectedFirefighter =
    snapshot?.firefighters.find((f) => f.callsign === selected) ?? null;

  const btn = (active: boolean): React.CSSProperties => ({
    background: active ? "#1E2650" : COLOURS.panel,
    border: `1px solid ${active ? COLOURS.text : COLOURS.border}`,
    color: COLOURS.text,
  });

  return (
    // min-h-screen, not h-screen: on a short window the page scrolls rather
    // than clipping the controls off the bottom.
    <div
      className="flex min-h-screen flex-col"
      style={{ background: COLOURS.background, color: COLOURS.text }}
    >
      {/* Simulation banner */}
      <div
        className="flex items-center justify-between px-4 py-2 text-sm font-bold tracking-wide"
        style={{ background: "#F0A020", color: "#05060F" }}
      >
        <span>SIMULATION MODE — NOT FOR OPERATIONAL USE</span>
        <span className="font-mono text-xs">
          {status === null
            ? "connecting…"
            : `${status.running ? "RUNNING" : "PAUSED"} · T+${status.incidentMinutes} min · ${status.speed}x`}
        </span>
      </div>

      {status?.lastError !== null && status?.lastError !== undefined && (
        <div className="px-4 py-1 text-xs" style={{ background: "#2A0A10", color: BAND_COLOUR.CRITICAL }}>
          simulator error: {status.lastError}
        </div>
      )}

      {/* Live inputs — what is going INTO the engine */}
      <div style={{ borderBottom: `1px solid ${COLOURS.border}`, background: COLOURS.panel }}>
        <InputsPanel snapshot={snapshot} status={status} />
      </div>

      {/* Main */}
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/*
          EXPLICIT height, in viewport units. A percentage or `flex-1` height
          only resolves if every ancestor has a definite height — with a
          `min-h-screen` root it collapses to zero and the map disappears.
        */}
        <div className="h-[52vh] min-w-0 flex-[3] p-2 lg:h-[calc(100vh-13rem)]">
          <IncidentMap snapshot={snapshot} selected={selected} onSelect={setSelected} />
        </div>

        <div
          className="flex h-[52vh] min-w-[340px] flex-[2] flex-col lg:h-[calc(100vh-13rem)]"
          style={{ borderLeft: `1px solid ${COLOURS.border}` }}
        >
          <div className="flex gap-1 p-2" style={{ borderBottom: `1px solid ${COLOURS.border}` }}>
            <button
              className="flex-1 rounded px-3 py-1.5 text-sm font-semibold"
              style={btn(view === "crew")}
              onClick={() => setView("crew")}
            >
              CREW
            </button>
            <button
              className="flex-1 rounded px-3 py-1.5 text-sm font-semibold"
              style={btn(view === "compare")}
              onClick={() => setView("compare")}
            >
              COMPARE
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-hidden">
            {view === "crew" ? (
              <CrewPanel snapshot={snapshot} selected={selected} onSelect={setSelected} />
            ) : (
              <ComparePanel />
            )}
          </div>
        </div>

        {selectedFirefighter !== null && view === "crew" && (
          <div className="h-[52vh] w-full shrink-0 lg:h-[calc(100vh-13rem)] lg:w-[380px]">
            <DetailPanel
              firefighter={selectedFirefighter}
              onClose={() => setSelected(null)}
            />
          </div>
        )}
      </div>

      {/* Controls */}
      <div
        className="flex flex-wrap items-center gap-2 px-3 py-2"
        style={{ borderTop: `1px solid ${COLOURS.border}`, background: COLOURS.panel }}
      >
        <button
          className="rounded px-4 py-2 text-sm font-bold"
          style={{ background: BAND_COLOUR.SAFE, color: "#05060F" }}
          onClick={() => void act({ action: "start" })}
        >
          ▶ PLAY
        </button>
        <button
          className="rounded px-4 py-2 text-sm font-bold"
          style={btn(false)}
          onClick={() => void act({ action: "pause" })}
        >
          ⏸ PAUSE
        </button>
        <button
          className="rounded px-4 py-2 text-sm font-bold"
          style={btn(false)}
          onClick={() => {
            setSelected(null);
            void act({ action: "reset" });
          }}
        >
          ↺ RESET
        </button>

        <div className="mx-2 flex gap-1">
          {[1, 5, 20].map((s) => (
            <button
              key={s}
              className="rounded px-3 py-2 text-sm font-mono font-bold"
              style={btn(status?.speed === s)}
              onClick={() => void act({ action: "speed", speed: s })}
            >
              {s}x
            </button>
          ))}
        </div>

        <button
          className="rounded px-4 py-2 text-sm font-bold"
          style={{
            background: status?.windShiftActive === true ? BAND_COLOUR.HIGH : COLOURS.panel,
            border: `1px solid ${BAND_COLOUR.HIGH}`,
            color: status?.windShiftActive === true ? "#05060F" : BAND_COLOUR.HIGH,
          }}
          onClick={() => void act({ action: "inject", inject: "wind_shift" })}
        >
          WIND SHIFT
        </button>

        <div className="relative">
          <button
            className="rounded px-4 py-2 text-sm font-bold"
            style={{ background: COLOURS.panel, border: `1px solid ${BAND_COLOUR.UNKNOWN}`, color: BAND_COLOUR.UNKNOWN }}
            onClick={() => setKillOpen((v) => !v)}
          >
            KILL SENSOR
          </button>
          {killOpen && (
            <div
              className="absolute bottom-full left-0 mb-2 w-72 rounded p-2"
              style={{ background: COLOURS.panel, border: `1px solid ${COLOURS.border}` }}
            >
              <div className="mb-1 text-xs font-semibold" style={{ color: COLOURS.muted }}>
                Stop refreshing a channel — staleness does the rest
              </div>
              {(snapshot?.firefighters ?? []).map((f) => (
                <div key={f.callsign} className="mb-1">
                  <div className="font-mono text-xs font-bold">{f.callsign}</div>
                  <div className="flex flex-wrap gap-1">
                    {KILLABLE.map((c) => (
                      <button
                        key={c.key}
                        className="rounded px-1.5 py-0.5 text-[10px]"
                        style={{ border: `1px solid ${COLOURS.border}`, color: COLOURS.text }}
                        onClick={() => {
                          void act({
                            action: "inject",
                            inject: "kill_sensor",
                            callsign: f.callsign,
                            channel: c.key,
                          });
                          setKillOpen(false);
                        }}
                      >
                        {c.label}
                      </button>
                    ))}
                    <button
                      className="rounded px-1.5 py-0.5 text-[10px]"
                      style={{ border: `1px solid ${BAND_COLOUR.SAFE}`, color: BAND_COLOUR.SAFE }}
                      onClick={() => {
                        void act({
                          action: "inject",
                          inject: "restore_sensors",
                          callsign: f.callsign,
                        });
                        setKillOpen(false);
                      }}
                    >
                      restore
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <a
          href="/assumptions"
          className="ml-auto rounded px-3 py-2 text-xs"
          style={{ border: `1px solid ${COLOURS.border}`, color: COLOURS.muted }}
        >
          Model assumptions
        </a>
      </div>
    </div>
  );
}
