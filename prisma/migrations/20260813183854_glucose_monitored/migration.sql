-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_FirefighterProfile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organisationId" TEXT NOT NULL,
    "callsign" TEXT NOT NULL,
    "ageYears" INTEGER NOT NULL,
    "fitness" TEXT NOT NULL,
    "restingHrBpm" INTEGER NOT NULL,
    "spo2BaselinePct" INTEGER NOT NULL,
    "conditionsJson" TEXT NOT NULL,
    "respiratoryRisk" TEXT NOT NULL,
    "heatTolerance" TEXT NOT NULL,
    "prevShiftHours" REAL NOT NULL,
    "cumulativeCoExposureIndex" REAL NOT NULL,
    "cumulativeHeatExposureIndex" REAL NOT NULL,
    "glucoseMonitored" BOOLEAN NOT NULL DEFAULT false,
    "createdAtUtc" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAtUtc" DATETIME NOT NULL,
    CONSTRAINT "FirefighterProfile_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_FirefighterProfile" ("ageYears", "callsign", "conditionsJson", "createdAtUtc", "cumulativeCoExposureIndex", "cumulativeHeatExposureIndex", "fitness", "heatTolerance", "id", "organisationId", "prevShiftHours", "respiratoryRisk", "restingHrBpm", "spo2BaselinePct", "updatedAtUtc") SELECT "ageYears", "callsign", "conditionsJson", "createdAtUtc", "cumulativeCoExposureIndex", "cumulativeHeatExposureIndex", "fitness", "heatTolerance", "id", "organisationId", "prevShiftHours", "respiratoryRisk", "restingHrBpm", "spo2BaselinePct", "updatedAtUtc" FROM "FirefighterProfile";
DROP TABLE "FirefighterProfile";
ALTER TABLE "new_FirefighterProfile" RENAME TO "FirefighterProfile";
CREATE INDEX "FirefighterProfile_organisationId_idx" ON "FirefighterProfile"("organisationId");
CREATE UNIQUE INDEX "FirefighterProfile_organisationId_callsign_key" ON "FirefighterProfile"("organisationId", "callsign");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
