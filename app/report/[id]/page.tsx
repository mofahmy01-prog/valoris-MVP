/**
 * Post-incident report, rendered.
 *
 * Reads straight from the database rather than through the API route: a page
 * that fetches its own endpoint adds a round trip and a second failure mode for
 * no benefit. Both call the same `buildIncidentReport`, so they cannot disagree.
 *
 * The layout puts COMPLETENESS above every finding on purpose. A report that
 * opens with conclusions and buries its gaps invites the reader to treat a
 * missing outcome as an absence of events rather than an absence of data.
 *
 * SIMULATION MODE — NOT FOR OPERATIONAL USE.
 */

import { prisma } from "@/lib/db/client";
import { buildIncidentReport } from "@/lib/report/incident-report";

export const dynamic = "force-dynamic";

const BAND_CLASS: Record<string, string> = {
  SAFE: "text-emerald-400",
  CAUTION: "text-amber-400",
  HIGH: "text-orange-400",
  CRITICAL: "text-red-400",
  UNKNOWN: "text-slate-400",
};

function duration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s === 0 ? `${m}m` : `${m}m ${s}s`;
}

export default async function ReportPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const incident = await prisma.incident.findUnique({ where: { id } });
  if (incident === null) {
    return (
      <main className="mx-auto max-w-5xl px-6 py-10 text-slate-200">
        <h1 className="text-2xl font-semibold">No such incident</h1>
        <p className="mt-2 text-sm text-slate-400">Nothing is recorded under {id}.</p>
      </main>
    );
  }

  const [deployments, assessments, recommendations, outcomes] = await Promise.all([
    prisma.deployment.findMany({
      where: { incidentId: id },
      include: { firefighter: true },
      orderBy: { assignedAtUtc: "asc" },
    }),
    prisma.riskAssessmentRecord.findMany({
      where: { incidentId: id },
      orderBy: { calculatedAtUtc: "asc" },
    }),
    prisma.recommendation.findMany({
      where: { incidentId: id },
      include: { commanderActions: true },
      orderBy: { createdAtUtc: "asc" },
    }),
    prisma.incidentOutcome.findMany({ where: { incidentId: id } }),
  ]);

  const report = buildIncidentReport({
    incident,
    deployments,
    assessments,
    recommendations,
    outcomes,
  });

  return (
    <main className="mx-auto max-w-5xl px-6 py-10 text-slate-200">
      <div className="mb-6 rounded border border-amber-500 bg-amber-500 px-4 py-2 text-center text-sm font-semibold text-black">
        SIMULATION MODE — NOT FOR OPERATIONAL USE
      </div>

      <a href="/" className="text-sm text-slate-400 underline">
        back to the incident
      </a>

      <h1 className="mt-4 text-2xl font-semibold">Post-incident report</h1>
      <p className="mt-1 text-sm text-slate-400">
        {report.incident.name} · {report.incident.scenarioKey} ·{" "}
        {report.incident.durationSec === null
          ? "duration not recorded"
          : duration(report.incident.durationSec)}
      </p>

      <section
        className={`mt-6 rounded border p-4 ${
          report.completeness.complete
            ? "border-emerald-700 bg-emerald-950/30"
            : "border-amber-600 bg-amber-950/30"
        }`}
      >
        <h2 className="text-sm font-semibold uppercase tracking-wide">
          Completeness — {report.completeness.outcomesRecorded} of{" "}
          {report.completeness.deployments} outcomes recorded
        </h2>
        <p className="mt-2 text-sm text-slate-300">{report.completeness.note}</p>
      </section>

      <section className="mt-6 rounded border border-slate-700 p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-300">
          Reproducibility
        </h2>
        <p className="mt-2 font-mono text-xs text-slate-400">
          model {report.reproducibility.modelVersion} · config{" "}
          {report.reproducibility.configHash} · {report.totals.assessments} assessments
        </p>
        {report.reproducibility.configChangedDuringIncident && (
          <p className="mt-2 text-sm text-amber-400">
            The configuration changed during this incident (
            {report.reproducibility.configHashesSeen.join(", ")}). Assessments either
            side are not one series.
          </p>
        )}
      </section>

      <section className="mt-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-300">
          Crew
        </h2>

        {report.firefighters.map((f) => (
          <div key={f.callsign} className="mt-3 rounded border border-slate-700 p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="font-mono text-base font-bold">{f.callsign}</span>
              <span className="text-xs text-slate-400">
                {f.ageYears} yrs · {f.fitness} fitness ·{" "}
                {f.conditions.length === 0 ? "no conditions" : f.conditions.join(", ")}
              </span>
            </div>

            <p className="mt-2 text-sm">
              Peak{" "}
              <span className={`font-bold ${BAND_CLASS[f.peakBand] ?? ""}`}>
                {f.peakBand}
              </span>{" "}
              at {f.peakScore}/100 · {f.assessments} assessments ·{" "}
              {f.bandTransitions.length} band change
              {f.bandTransitions.length === 1 ? "" : "s"}
            </p>

            {f.timeInBand.length > 0 && (
              <p className="mt-1 font-mono text-xs text-slate-400">
                {f.timeInBand.map((s) => `${s.band} ${duration(s.seconds)}`).join("  ·  ")}
              </p>
            )}

            <p className="mt-2 text-xs text-slate-400">
              Data quality: {f.dataQuality.lowConfidenceAssessments} low-confidence,{" "}
              {f.dataQuality.assessmentsWithMissingInputs} with missing inputs,{" "}
              {f.dataQuality.assessmentsWithProjectedInputs} scored partly on{" "}
              <span className="text-slate-200">estimated</span> values
            </p>

            {f.recommendations.length > 0 && (
              <div className="mt-3 border-t border-slate-800 pt-2">
                {f.recommendations.map((r, i) => (
                  <div key={i} className="mt-2 text-xs">
                    <span className="font-mono font-bold text-slate-200">{r.type}</span>{" "}
                    <span className="text-slate-500">
                      ({r.confidence} confidence) to {r.status}
                    </span>
                    <div className="text-slate-400">{r.suggestedAction}</div>
                    {r.actions.map((a, j) => (
                      <div key={j} className="mt-0.5 text-slate-500">
                        {a.action} by {a.actorLabel}
                        {a.reasonText === null ? "" : ` — ${a.reasonText}`}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}

            <div className="mt-3 border-t border-slate-800 pt-2 text-sm">
              {f.outcome.recorded ? (
                <span>
                  Outcome:{" "}
                  <span className="font-bold text-slate-100">{f.outcome.outcome}</span>
                  {f.outcome.interventionOccurred === true && (
                    <span className="text-amber-400"> · intervention occurred</span>
                  )}
                  <span className="text-slate-500"> · recorded by {f.outcome.recordedBy}</span>
                </span>
              ) : (
                <span className="text-amber-400">
                  Outcome: NOT RECORDED — this is unknown, not a finding that nothing
                  happened
                </span>
              )}
            </div>
          </div>
        ))}
      </section>

      <section className="mt-6 rounded border border-slate-700 p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-300">
          Advice
        </h2>
        <p className="mt-2 font-mono text-xs text-slate-400">
          {report.totals.recommendations} raised · {report.totals.recommendationsAccepted}{" "}
          accepted · {report.totals.recommendationsRejected} declined ·{" "}
          {report.totals.recommendationsExpiredUnactioned} expired unactioned
        </p>
        {report.totals.recommendationsExpiredUnactioned > 0 && (
          <p className="mt-2 text-xs text-slate-400">
            Advice that expired unactioned is a different fact from advice that was
            considered and declined. Nobody looked at it.
          </p>
        )}
      </section>

      <section className="mt-6 rounded border border-slate-700 p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-300">
          What this report cannot tell you
        </h2>
        <ul className="mt-2 space-y-2">
          {report.limitations.map((l, i) => (
            <li key={i} className="text-xs leading-relaxed text-slate-400">
              {l}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
