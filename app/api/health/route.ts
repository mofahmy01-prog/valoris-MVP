import { prisma } from "@/lib/db/client";
import { listFireFrontProviders } from "@/lib/fire/registry";
import { DEFAULT_RISK_CONFIG } from "@/lib/risk/default-config";
import { ok, serverError } from "@/lib/api/respond";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (error) {
    return serverError(
      `Database unreachable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  return ok({
    status: "ok",
    simulationOnly: true,
    clinicallyValidated: false,
    modelVersion: DEFAULT_RISK_CONFIG.modelVersion,
    configHash: DEFAULT_RISK_CONFIG.configHash,
    parameterCount: Object.keys(DEFAULT_RISK_CONFIG.parameters).length,
    fireFrontProviders: listFireFrontProviders(),
    fireBehaviourModelling:
      "Valoris does not model fire behaviour. It consumes a fire front from an external source and translates it into individual risk.",
  });
}
