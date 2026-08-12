/**
 * Seeds one organisation and the six deliberately varied firefighter profiles
 * from the build spec. Idempotent — safe to run repeatedly.
 *
 * These are fictional people. No real personal or medical data is used anywhere
 * in Valoris.
 *
 * SIMULATION MODE — NOT FOR OPERATIONAL USE.
 */

import { PrismaClient } from "@prisma/client";

import { applyDatabaseGuards, DATABASE_GUARDS } from "../lib/db/guards";

const prisma = new PrismaClient();

const ORGANISATION_NAME = "Valoris Demonstration Fire Service (fictional)";

type SeedProfile = {
  callsign: string;
  ageYears: number;
  fitness: "low" | "moderate" | "high";
  restingHrBpm: number;
  spo2BaselinePct: number;
  conditions: string[];
  respiratoryRisk: "none" | "mild" | "moderate" | "high";
  heatTolerance: "low" | "avg" | "high";
  prevShiftHours: number;
  cumulativeCoExposureIndex: number;
  cumulativeHeatExposureIndex: number;
};

const PROFILES: SeedProfile[] = [
  {
    callsign: "ALPHA-1",
    ageYears: 28,
    fitness: "high",
    restingHrBpm: 50,
    spo2BaselinePct: 98,
    conditions: [],
    respiratoryRisk: "none",
    heatTolerance: "high",
    prevShiftHours: 0,
    cumulativeCoExposureIndex: 0.05,
    cumulativeHeatExposureIndex: 0.05,
  },
  {
    callsign: "ALPHA-2",
    ageYears: 41,
    fitness: "moderate",
    restingHrBpm: 62,
    spo2BaselinePct: 97,
    conditions: ["mild hypertension"],
    respiratoryRisk: "none",
    heatTolerance: "avg",
    prevShiftHours: 4,
    cumulativeCoExposureIndex: 0.15,
    cumulativeHeatExposureIndex: 0.2,
  },
  {
    callsign: "BRAVO-1",
    ageYears: 34,
    fitness: "high",
    restingHrBpm: 55,
    spo2BaselinePct: 98,
    conditions: ["type 1 diabetes"],
    respiratoryRisk: "none",
    heatTolerance: "avg",
    prevShiftHours: 2,
    cumulativeCoExposureIndex: 0.1,
    cumulativeHeatExposureIndex: 0.1,
  },
  {
    callsign: "BRAVO-2",
    ageYears: 52,
    fitness: "moderate",
    restingHrBpm: 70,
    spo2BaselinePct: 95,
    conditions: ["moderate asthma"],
    respiratoryRisk: "moderate",
    heatTolerance: "low",
    prevShiftHours: 6,
    cumulativeCoExposureIndex: 0.35,
    cumulativeHeatExposureIndex: 0.3,
  },
  {
    callsign: "CHARLIE-1",
    ageYears: 45,
    fitness: "low",
    restingHrBpm: 78,
    spo2BaselinePct: 96,
    conditions: [],
    respiratoryRisk: "none",
    heatTolerance: "low",
    prevShiftHours: 11,
    cumulativeCoExposureIndex: 0.4,
    cumulativeHeatExposureIndex: 0.45,
  },
  {
    callsign: "CHARLIE-2",
    ageYears: 38,
    fitness: "moderate",
    restingHrBpm: 64,
    spo2BaselinePct: 96,
    conditions: ["mild reactive airway"],
    respiratoryRisk: "mild",
    heatTolerance: "avg",
    prevShiftHours: 3,
    cumulativeCoExposureIndex: 0.2,
    cumulativeHeatExposureIndex: 0.2,
  },
];

async function main(): Promise<void> {
  // Guards first. `npm run seed` runs immediately after `npx prisma migrate dev`
  // in the documented startup, so the append-only guarantees are restored on
  // every startup rather than depending on anyone remembering a separate step.
  const guards = await applyDatabaseGuards(prisma);
  if (guards.missingBefore.length > 0) {
    console.log("!".repeat(78));
    console.log(
      `GUARD INTEGRITY FAILURE: ${guards.missingBefore.length} database guard(s) were missing and have been restored:`,
    );
    for (const name of guards.missingBefore) console.log(`  - ${name}`);
    console.log(
      "Cause is almost always a Prisma migration rebuilding a table and dropping its triggers.",
    );
    console.log("See docs/KNOWN_LIMITATIONS.md item 22.");
    console.log("!".repeat(78));
  }
  if (!guards.enforcing) {
    throw new Error(
      `Database guards are not enforcing: ${guards.enforcementDetail}. Refusing to seed.`,
    );
  }
  console.log(
    `Database guards: ${DATABASE_GUARDS.length} installed and enforcing (${guards.enforcementDetail}).`,
  );

  const existing = await prisma.organisation.findFirst({
    where: { name: ORGANISATION_NAME },
  });
  const organisation =
    existing ??
    (await prisma.organisation.create({ data: { name: ORGANISATION_NAME } }));

  for (const profile of PROFILES) {
    await prisma.firefighterProfile.upsert({
      where: {
        organisationId_callsign: {
          organisationId: organisation.id,
          callsign: profile.callsign,
        },
      },
      create: {
        organisationId: organisation.id,
        callsign: profile.callsign,
        ageYears: profile.ageYears,
        fitness: profile.fitness,
        restingHrBpm: profile.restingHrBpm,
        spo2BaselinePct: profile.spo2BaselinePct,
        conditionsJson: JSON.stringify(profile.conditions),
        respiratoryRisk: profile.respiratoryRisk,
        heatTolerance: profile.heatTolerance,
        prevShiftHours: profile.prevShiftHours,
        cumulativeCoExposureIndex: profile.cumulativeCoExposureIndex,
        cumulativeHeatExposureIndex: profile.cumulativeHeatExposureIndex,
      },
      update: {
        ageYears: profile.ageYears,
        fitness: profile.fitness,
        restingHrBpm: profile.restingHrBpm,
        spo2BaselinePct: profile.spo2BaselinePct,
        conditionsJson: JSON.stringify(profile.conditions),
        respiratoryRisk: profile.respiratoryRisk,
        heatTolerance: profile.heatTolerance,
        prevShiftHours: profile.prevShiftHours,
        cumulativeCoExposureIndex: profile.cumulativeCoExposureIndex,
        cumulativeHeatExposureIndex: profile.cumulativeHeatExposureIndex,
      },
    });
  }

  const count = await prisma.firefighterProfile.count({
    where: { organisationId: organisation.id },
  });

  console.log("SIMULATION MODE — NOT FOR OPERATIONAL USE");
  console.log(`Organisation: ${organisation.name}`);
  console.log(`Firefighter profiles: ${count}`);
  for (const profile of PROFILES) {
    console.log(
      `  ${profile.callsign.padEnd(10)} age ${String(profile.ageYears).padStart(2)}  ${profile.fitness.padEnd(8)} resp:${profile.respiratoryRisk.padEnd(8)} heat:${profile.heatTolerance.padEnd(4)} prevShift:${profile.prevShiftHours}h  ${profile.conditions.length === 0 ? "no declared conditions" : profile.conditions.join(", ")}`,
    );
  }
  console.log("Fictional people. No real personal or medical data.");
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
