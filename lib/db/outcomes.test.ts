/**
 * Outcome capture invariants.
 *
 * These tests exist because outcome data is the only thing that can ever tell
 * us whether the risk engine is right. If it can be edited, unattributed, or
 * quietly defaulted to "nothing", it is not evidence — and the failure would be
 * invisible, because a corrupted label set still trains a model happily.
 *
 * The database is the last line of defence here, so these assert the SQLite
 * triggers directly rather than trusting the API layer to hold.
 */

import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { INCIDENT_OUTCOMES } from "./enums";
import { DATABASE_GUARDS, listInstalledGuards } from "./guards";
import { recordOutcomeSchema } from "@/lib/api/schemas";

const prisma = new PrismaClient();

let incidentId = "";
let deploymentId = "";
let secondDeploymentId = "";

beforeAll(async () => {
  const org = await prisma.organisation.create({
    data: { name: `outcome-test-${Date.now()}` },
  });
  const incident = await prisma.incident.create({
    data: {
      organisationId: org.id,
      name: "outcome test",
      status: "stopped",
      scenarioKey: "test",
      fireProviderKey: "geometric_spread_placeholder",
      centroidLat: 0,
      centroidLng: 0,
      modelVersion: "test",
      configHash: "test",
    },
  });
  incidentId = incident.id;
  const crew = await prisma.crew.create({
    data: { incidentId: incident.id, name: "TEST" },
  });

  const make = async (callsign: string) => {
    const ff = await prisma.firefighterProfile.create({
      data: {
        organisationId: org.id,
        callsign,
        ageYears: 30,
        fitness: "moderate",
        restingHrBpm: 60,
        spo2BaselinePct: 97,
        conditionsJson: "[]",
        respiratoryRisk: "none",
        heatTolerance: "avg",
        prevShiftHours: 0,
        cumulativeCoExposureIndex: 0,
        cumulativeHeatExposureIndex: 0,
      },
    });
    const dep = await prisma.deployment.create({
      data: {
        incidentId: incident.id,
        crewId: crew.id,
        firefighterProfileId: ff.id,
      },
    });
    return dep.id;
  };

  deploymentId = await make(`OUT-1-${Date.now()}`);
  secondDeploymentId = await make(`OUT-2-${Date.now()}`);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("outcome capture — the record must be trustworthy", () => {
  it("installs every guard the module declares", async () => {
    const installed = await listInstalledGuards(prisma);
    for (const guard of DATABASE_GUARDS) {
      expect(installed, `missing guard ${guard.name}`).toContain(guard.name);
    }
  });

  it("keeps `unknown` distinct from `nothing`", () => {
    // Both must exist as recordable values. If `unknown` were ever dropped, an
    // unrecorded outcome would have nowhere to go but `nothing`, which biases
    // every future calibration toward "nobody gets hurt".
    expect(INCIDENT_OUTCOMES).toContain("unknown");
    expect(INCIDENT_OUTCOMES).toContain("nothing");
    expect(recordOutcomeSchema.safeParse({
      callsign: "A", outcome: "unknown", recordedBy: "ic",
    }).success).toBe(true);
  });

  it("has no default outcome — the field must be supplied", () => {
    const parsed = recordOutcomeSchema.safeParse({ callsign: "A", recordedBy: "ic" });
    expect(parsed.success).toBe(false);
  });

  it("refuses an outcome that names nobody as its recorder", () => {
    for (const recordedBy of ["", "   "]) {
      const parsed = recordOutcomeSchema.safeParse({
        callsign: "A", outcome: "nothing", recordedBy,
      });
      expect(parsed.success, `accepted recordedBy=${JSON.stringify(recordedBy)}`).toBe(false);
    }
  });

  it("treats an unrecorded intervention as absent, never as false", () => {
    const parsed = recordOutcomeSchema.parse({
      callsign: "A", outcome: "nothing", recordedBy: "ic",
    });
    // Absent, not coerced. A firefighter withdrawn before the outcome was seen
    // is a censored observation; defaulting to `false` would lose that.
    expect(parsed.interventionOccurred).toBeUndefined();
  });

  it("rejects an UPDATE at the database, not just in code", async () => {
    const row = await prisma.incidentOutcome.create({
      data: { incidentId, deploymentId, outcome: "near_miss", recordedBy: "ic-1" },
    });
    await expect(
      prisma.$executeRawUnsafe(
        `UPDATE "IncidentOutcome" SET "outcome" = 'nothing' WHERE "id" = ?`,
        row.id,
      ),
    ).rejects.toThrow(/append-only|not permitted/i);

    const after = await prisma.incidentOutcome.findUnique({ where: { id: row.id } });
    expect(after?.outcome).toBe("near_miss");
  });

  it("rejects a DELETE at the database", async () => {
    const row = await prisma.incidentOutcome.findFirst({ where: { deploymentId } });
    expect(row).not.toBeNull();
    await expect(
      prisma.$executeRawUnsafe(`DELETE FROM "IncidentOutcome" WHERE "id" = ?`, row!.id),
    ).rejects.toThrow(/append-only|not permitted/i);
  });

  it("rejects an outcome value outside the recorded set", async () => {
    await expect(
      prisma.$executeRawUnsafe(
        `INSERT INTO "IncidentOutcome" ("id","incidentId","deploymentId","outcome","recordedBy","recordedAtUtc")
         VALUES (?, ?, ?, 'fine_probably', 'ic-1', CURRENT_TIMESTAMP)`,
        `bad-${Date.now()}`,
        incidentId,
        secondDeploymentId,
      ),
    ).rejects.toThrow(/not one of the recorded values/i);
  });

  it("rejects an unattributed outcome at the database", async () => {
    await expect(
      prisma.$executeRawUnsafe(
        `INSERT INTO "IncidentOutcome" ("id","incidentId","deploymentId","outcome","recordedBy","recordedAtUtc")
         VALUES (?, ?, ?, 'nothing', '   ', CURRENT_TIMESTAMP)`,
        `blank-${Date.now()}`,
        incidentId,
        secondDeploymentId,
      ),
    ).rejects.toThrow(/must name who recorded it/i);
  });

  it("allows only one outcome per firefighter per incident", async () => {
    await expect(
      prisma.incidentOutcome.create({
        data: { incidentId, deploymentId, outcome: "nothing", recordedBy: "ic-2" },
      }),
    ).rejects.toThrow();
  });
});
