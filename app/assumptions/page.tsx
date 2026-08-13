import { DEFAULT_PHYSIOLOGY_CONFIG } from "@/lib/physiology/default-config";
import { listPhysiologyParameters } from "@/lib/physiology/config";
import { DEFAULT_RISK_CONFIG } from "@/lib/risk/default-config";
import { listParameters } from "@/lib/risk/config";

export default function Home() {
  const parameters = listParameters(DEFAULT_RISK_CONFIG);
  const physiologyParameters = listPhysiologyParameters(DEFAULT_PHYSIOLOGY_CONFIG);
  const unverified = physiologyParameters.filter(
    (p) => p.sourceStatus === "literature_derived" && p.rationale.includes("UNVERIFIED"),
  );

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <div className="mb-6 rounded border border-amber-500 bg-amber-500 px-4 py-2 text-center text-sm font-semibold text-black">
        SIMULATION MODE — NOT FOR OPERATIONAL USE
      </div>
      <a href="/" className="text-sm text-slate-400 underline">
        ← back to the incident
      </a>
      <h1 className="mt-4 text-2xl font-semibold">Valoris</h1>
      <p className="mt-2 max-w-2xl text-sm text-slate-400">
        Research prototype for firefighter safety monitoring. Not a medical device. Not
        clinically validated. Not an autonomous system. Not for operational use.
      </p>

      <section className="mt-8 rounded border border-slate-700 p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-300">
          Build status
        </h2>
        <p className="mt-2 text-sm text-slate-400">
          Milestone 1 complete: the deterministic risk engine in{" "}
          <code className="text-slate-200">lib/risk/</code>. No database, API, simulator,
          dashboard, forecasting or reporting yet.
        </p>
        <p className="mt-2 text-sm text-slate-400">
          Model <span className="text-slate-200">{DEFAULT_RISK_CONFIG.modelVersion}</span>{" "}
          · config hash{" "}
          <span className="text-slate-200">{DEFAULT_RISK_CONFIG.configHash}</span> ·{" "}
          {parameters.length} named parameters
        </p>
      </section>

      {unverified.length > 0 && (
        <section
          role="alert"
          className="mt-8 rounded border-2 border-red-500 bg-red-950/40 p-4"
        >
          <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-red-300">
            <span aria-hidden="true">!</span>
            Unverified model coefficients
          </h2>
          <p className="mt-2 text-sm font-semibold text-red-100">
            Core temperature estimator coefficients are unverified transcriptions
            pending source verification.
          </p>
          <p className="mt-2 text-sm text-red-200">
            {unverified.length} parameters in the sequential Kalman core-temperature
            estimator are marked <code>literature_derived</code> but their values have
            not been checked against the primary source by anyone. They determine every
            core temperature in this system.
          </p>
          <p className="mt-2 text-xs text-red-200/90">
            Source to verify: Buller MJ, Tharion WJ, Cheuvront SN, et al. Estimation of
            human core temperature from sequential heart rate observations.{" "}
            <em>Physiological Measurement</em> 2013;34(7):781–98. Tracked as blocking
            item 1 in <code>docs/DATA_PROVENANCE.md</code>.
          </p>
          <ul className="mt-3 flex flex-wrap gap-2 text-xs">
            {unverified.map((p) => (
              <li
                key={p.name}
                className="rounded border border-red-500/60 px-2 py-0.5 font-mono text-red-100"
              >
                {p.name}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-8">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-300">
          Model assumptions
        </h2>
        <p className="mt-1 text-sm text-slate-400">
          Every threshold below is illustrative and unreviewed. No external guideline
          validates this model. ADA and British Thoracic Society material may inform
          individual thresholds; they do not validate Valoris.
        </p>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-slate-700 text-slate-300">
                <th className="py-2 pr-4 font-semibold">Parameter</th>
                <th className="py-2 pr-4 font-semibold">Value</th>
                <th className="py-2 pr-4 font-semibold">Unit</th>
                <th className="py-2 pr-4 font-semibold">Source</th>
                <th className="py-2 pr-4 font-semibold">Citation</th>
                <th className="py-2 font-semibold">Clinical review</th>
              </tr>
            </thead>
            <tbody>
              {[...parameters, ...physiologyParameters].map((p) => {
                const isUnverified =
                  p.sourceStatus === "literature_derived" &&
                  p.rationale.includes("UNVERIFIED");
                return (
                  <tr
                    key={p.name}
                    className={`border-b border-slate-800 ${isUnverified ? "bg-red-950/30 text-red-200" : "text-slate-400"}`}
                  >
                    <td
                      className={`py-1.5 pr-4 font-mono ${isUnverified ? "text-red-100" : "text-slate-200"}`}
                    >
                      {p.name}
                    </td>
                    <td className="py-1.5 pr-4 tabular-nums">{p.value}</td>
                    <td className="py-1.5 pr-4">{p.unit}</td>
                    <td className="py-1.5 pr-4">
                      {p.sourceStatus}
                      {isUnverified && (
                        <span className="ml-1 font-semibold text-red-300">
                          — UNVERIFIED
                        </span>
                      )}
                    </td>
                    <td className="py-1.5 pr-4">{p.citation ?? "—"}</td>
                    <td className="py-1.5">{p.clinicalReviewStatus}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
