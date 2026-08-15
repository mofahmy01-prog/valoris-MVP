import { DemoClient } from "../demo/DemoClient";

/**
 * The tick-based live view: a running simulator posting through the real
 * ingestion route, sensor-kill injections and all. Kept because it demonstrates
 * something the scrubbable commander view deliberately does not — observations
 * going through `POST /observations` with validation, provenance and the audit
 * log — whereas the commander view evaluates the engine in memory so that
 * scrubbing backwards stays consistent.
 */
export default function LivePage() {
  return <DemoClient />;
}
