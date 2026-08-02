import { DEFAULT_RISK_CONFIG } from "@/lib/risk/default-config";
import { listParameters } from "@/lib/risk/config";

export default function Home() {
  const parameters = listParameters(DEFAULT_RISK_CONFIG);

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <h1 className="text-2xl font-semibold">Valoris</h1>
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
                <th className="py-2 font-semibold">Clinical review</th>
              </tr>
            </thead>
            <tbody>
              {parameters.map((p) => (
                <tr key={p.name} className="border-b border-slate-800 text-slate-400">
                  <td className="py-1.5 pr-4 font-mono text-slate-200">{p.name}</td>
                  <td className="py-1.5 pr-4 tabular-nums">{p.value}</td>
                  <td className="py-1.5 pr-4">{p.unit}</td>
                  <td className="py-1.5 pr-4">{p.sourceStatus}</td>
                  <td className="py-1.5">{p.clinicalReviewStatus}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
