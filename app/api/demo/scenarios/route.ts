/**
 * The named scenarios, and what each one is for.
 *
 * Exposed so an operator can see what a scenario exercises and what to watch
 * for BEFORE running it. A scenario whose purpose has to be explained verbally
 * is not reproducible in any useful sense.
 *
 * SIMULATION MODE — NOT FOR OPERATIONAL USE.
 */

import { ok } from "@/lib/api/respond";
import { SCENARIOS } from "@/lib/sim/scenarios";

export const dynamic = "force-dynamic";

export async function GET() {
  return ok({
    scenarios: SCENARIOS.map((s) => ({
      key: s.key,
      title: s.title,
      synopsis: s.synopsis,
      exercises: s.exercises,
      expect: s.expect,
      noiseProfile: s.noiseProfile,
      steps: s.steps,
    })),
    howToRun: 'POST /api/sim {"action":"scenario","scenario":"<key>"} then {"action":"start"}',
    notice:
      "These are INVENTED situations chosen to exercise different parts of the engine. None is a reconstruction of a real incident.",
  });
}
