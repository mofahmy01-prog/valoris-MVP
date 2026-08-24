"use client";

/**
 * Recording outcomes at incident close.
 *
 * This is the form the person closing the incident fills in, and it is the only
 * way the gating record for a pilot ever gets created. Everything about it is
 * shaped by one problem: an outcome recorded carelessly is worse than no outcome
 * at all, because it looks like evidence.
 *
 * So:
 *
 *   - There is NO DEFAULT SELECTION. A form pre-set to "nothing" would collect
 *     "nothing" for anyone the recorder scrolled past, and those false negatives
 *     would be indistinguishable from real ones forever after.
 *   - `unknown` is offered as a first-class choice, phrased as a real answer
 *     rather than a failure to answer, because the honest response to "I do not
 *     know what happened to them" must be easier than guessing.
 *   - The intervention question is asked separately and defaults to unanswered,
 *     because it decides whether the observation is censored for calibration.
 *   - Attribution is required, with no remembered default, so a name is a
 *     deliberate act each time.
 *
 * SIMULATION MODE — NOT FOR OPERATIONAL USE.
 */

import { useState } from "react";

const OUTCOMES: { value: string; label: string; help: string }[] = [
  { value: "nothing", label: "Nothing", help: "Completed the incident without event." },
  { value: "rehab_required", label: "Rehab required", help: "Stood down for rehabilitation." },
  { value: "heat_exhaustion", label: "Heat exhaustion", help: "Heat illness, any severity." },
  { value: "near_miss", label: "Near miss", help: "No injury, but a credible one was avoided." },
  { value: "medical_attention", label: "Medical attention", help: "Assessed or treated by a medic." },
  { value: "hospital_transport", label: "Hospital transport", help: "Transported to hospital." },
  {
    value: "unknown",
    label: "Not known",
    help: "You do not know what happened to them. This is a real answer and is NOT the same as nothing.",
  },
];

type Row = { outcome: string; intervention: "" | "yes" | "no"; notes: string };

export function OutcomeForm({
  incidentId,
  callsigns,
}: {
  incidentId: string;
  callsigns: string[];
}) {
  const [rows, setRows] = useState<Record<string, Row>>({});
  const [recordedBy, setRecordedBy] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const update = (callsign: string, patch: Partial<Row>): void => {
    setRows((current) => ({
      ...current,
      [callsign]: {
        outcome: "",
        intervention: "",
        notes: "",
        ...current[callsign],
        ...patch,
      },
    }));
  };

  const chosen = callsigns.filter((c) => (rows[c]?.outcome ?? "") !== "");

  const submit = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/incidents/${incidentId}/outcomes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          outcomes: chosen.map((callsign) => {
            const row = rows[callsign] as Row;
            return {
              callsign,
              outcome: row.outcome,
              // Unanswered stays absent. It must not become `false`.
              ...(row.intervention === ""
                ? {}
                : { interventionOccurred: row.intervention === "yes" }),
              ...(row.notes.trim() === "" ? {} : { notes: row.notes.trim() }),
              recordedBy: recordedBy.trim(),
            };
          }),
        }),
      });

      if (!response.ok) {
        const body: unknown = await response.json().catch(() => null);
        const message =
          typeof body === "object" && body !== null && "message" in body
            ? String((body as { message: unknown }).message)
            : `Request failed (${response.status})`;
        setError(message);
        return;
      }
      setDone(true);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <p className="mt-2 text-sm text-emerald-400">
        Recorded. Outcomes are append-only, so correcting one is a documented
        process rather than an edit here. Reload to see the updated report.
      </p>
    );
  }

  return (
    <div className="mt-3">
      <p className="text-xs leading-relaxed text-slate-400">
        Nothing is pre-selected on purpose. A firefighter you skip is recorded as
        having <span className="text-slate-200">no outcome</span>, which stays
        distinguishable from <span className="text-slate-200">nothing happened</span>{" "}
        forever after — choosing for them would destroy that distinction.
      </p>

      {callsigns.map((callsign) => {
        const row = rows[callsign];
        const selected = OUTCOMES.find((o) => o.value === row?.outcome);
        return (
          <div key={callsign} className="mt-3 rounded border border-slate-800 p-3">
            <div className="font-mono text-sm font-bold">{callsign}</div>

            <div className="mt-2 flex flex-wrap gap-1">
              {OUTCOMES.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => update(callsign, { outcome: o.value })}
                  className="rounded px-2 py-1 text-[11px]"
                  style={{
                    border: `1px solid ${row?.outcome === o.value ? "#E8ECF8" : "#334155"}`,
                    background: row?.outcome === o.value ? "#1E2650" : "transparent",
                    color: row?.outcome === o.value ? "#E8ECF8" : "#94a3b8",
                  }}
                >
                  {o.label}
                </button>
              ))}
            </div>

            {selected !== undefined && (
              <p className="mt-1 text-[11px] text-slate-500">{selected.help}</p>
            )}

            {row?.outcome !== undefined && row.outcome !== "" && (
              <div className="mt-2">
                <div className="text-[11px] text-slate-400">
                  Were they withdrawn, rested or otherwise intervened on before this
                  outcome was observed?
                </div>
                <div className="mt-1 flex gap-1">
                  {(["yes", "no"] as const).map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => update(callsign, { intervention: v })}
                      className="rounded px-2 py-0.5 text-[11px]"
                      style={{
                        border: `1px solid ${row.intervention === v ? "#E8ECF8" : "#334155"}`,
                        color: row.intervention === v ? "#E8ECF8" : "#94a3b8",
                      }}
                    >
                      {v}
                    </button>
                  ))}
                  <span className="self-center text-[10px] text-slate-500">
                    leave blank if not known — it will be recorded as unanswered, not
                    as no
                  </span>
                </div>

                <input
                  value={row.notes}
                  onChange={(e) => update(callsign, { notes: e.target.value })}
                  placeholder="notes (optional)"
                  className="mt-2 w-full rounded bg-slate-900 px-2 py-1 text-xs text-slate-200"
                  style={{ border: "1px solid #334155" }}
                />
              </div>
            )}
          </div>
        );
      })}

      <div className="mt-4">
        <label className="text-xs text-slate-400">
          Recorded by (required — an unattributed outcome is not evidence)
        </label>
        <input
          value={recordedBy}
          onChange={(e) => setRecordedBy(e.target.value)}
          placeholder="name or role"
          className="mt-1 w-full rounded bg-slate-900 px-2 py-1 text-sm text-slate-200"
          style={{ border: "1px solid #334155" }}
        />
      </div>

      {error !== null && <p className="mt-2 text-xs text-red-400">{error}</p>}

      <button
        type="button"
        disabled={busy || chosen.length === 0 || recordedBy.trim() === ""}
        onClick={() => void submit()}
        className="mt-3 rounded px-4 py-2 text-sm font-bold disabled:opacity-40"
        style={{ border: "1px solid #E8ECF8", color: "#E8ECF8" }}
      >
        {busy
          ? "Recording…"
          : `Record ${chosen.length} outcome${chosen.length === 1 ? "" : "s"}`}
      </button>

      {chosen.length > 0 && chosen.length < callsigns.length && (
        <p className="mt-2 text-[11px] text-amber-400">
          {callsigns.length - chosen.length} firefighter
          {callsigns.length - chosen.length === 1 ? "" : "s"} will be left with no
          recorded outcome. That is a valid state — it is recorded as unknown, not as
          nothing.
        </p>
      )}
    </div>
  );
}
