import { prisma } from "@/lib/db/client";
import { verifyDatabaseGuards } from "@/lib/db/guards";
import { listFireFrontProviders } from "@/lib/fire/registry";
import { DEFAULT_PHYSIOLOGY_CONFIG } from "@/lib/physiology/default-config";
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

  // Reported so a verification harness can refuse to run against a stale server
  // or an unguarded database.
  const guards = await verifyDatabaseGuards(prisma);

  return ok({
    status: "ok",
    simulationOnly: true,
    clinicallyValidated: false,
    modelVersion: DEFAULT_RISK_CONFIG.modelVersion,
    configHash: DEFAULT_RISK_CONFIG.configHash,
    physiologyModelVersion: DEFAULT_PHYSIOLOGY_CONFIG.modelVersion,
    physiologyConfigHash: DEFAULT_PHYSIOLOGY_CONFIG.configHash,
    parameterCount: Object.keys(DEFAULT_RISK_CONFIG.parameters).length,
    physiologyParameterCount: Object.keys(DEFAULT_PHYSIOLOGY_CONFIG.parameters).length,
    databaseGuards: {
      allInstalled: guards.ok,
      installed: guards.installed,
      missing: guards.missing,
    },
    coreTemperatureEstimator: {
      model: "core_temp_kalman_hr_v1",
      estimated: true,
      coefficientsVerified: false,
      warning:
        "Core temperature estimator coefficients are unverified transcriptions pending source verification.",
      citation:
        "Buller MJ, Tharion WJ, Cheuvront SN, et al. Estimation of human core temperature from sequential heart rate observations. Physiological Measurement 2013;34(7):781-98.",
    },
    fireFrontProviders: listFireFrontProviders(),
    fireBehaviourModelling:
      "Valoris does not model fire behaviour. It consumes a fire front from an external source and translates it into individual risk.",
  });
}
