-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_RiskAssessmentRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "incidentId" TEXT NOT NULL,
    "deploymentId" TEXT NOT NULL,
    "observationId" TEXT NOT NULL,
    "calculatedAtUtc" DATETIME NOT NULL,
    "scoreValue" REAL NOT NULL,
    "band" TEXT NOT NULL,
    "physiologicalSubscore" REAL NOT NULL,
    "environmentalSubscore" REAL NOT NULL,
    "proximitySubscore" REAL NOT NULL,
    "profileSubscore" REAL NOT NULL,
    "hardOverride" BOOLEAN NOT NULL,
    "hardOverrideReasonsJson" TEXT NOT NULL,
    "topDriversJson" TEXT NOT NULL,
    "explanation" TEXT NOT NULL,
    "confidence" TEXT NOT NULL,
    "staleInputsJson" TEXT NOT NULL,
    "missingInputsJson" TEXT NOT NULL,
    "oldestReadingAgeSec" INTEGER NOT NULL,
    "dataQualityNote" TEXT NOT NULL,
    "modelVersion" TEXT NOT NULL,
    "configHash" TEXT NOT NULL,
    "profileSnapshotJson" TEXT NOT NULL DEFAULT '{}',
    "riskConfigValuesJson" TEXT NOT NULL DEFAULT '{}',
    "physiologyConfigValuesJson" TEXT NOT NULL DEFAULT '{}',
    CONSTRAINT "RiskAssessmentRecord_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "RiskAssessmentRecord_deploymentId_fkey" FOREIGN KEY ("deploymentId") REFERENCES "Deployment" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "RiskAssessmentRecord_observationId_fkey" FOREIGN KEY ("observationId") REFERENCES "Observation" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_RiskAssessmentRecord" ("band", "calculatedAtUtc", "confidence", "configHash", "dataQualityNote", "deploymentId", "environmentalSubscore", "explanation", "hardOverride", "hardOverrideReasonsJson", "id", "incidentId", "missingInputsJson", "modelVersion", "observationId", "oldestReadingAgeSec", "physiologicalSubscore", "profileSubscore", "proximitySubscore", "scoreValue", "staleInputsJson", "topDriversJson") SELECT "band", "calculatedAtUtc", "confidence", "configHash", "dataQualityNote", "deploymentId", "environmentalSubscore", "explanation", "hardOverride", "hardOverrideReasonsJson", "id", "incidentId", "missingInputsJson", "modelVersion", "observationId", "oldestReadingAgeSec", "physiologicalSubscore", "profileSubscore", "proximitySubscore", "scoreValue", "staleInputsJson", "topDriversJson" FROM "RiskAssessmentRecord";
DROP TABLE "RiskAssessmentRecord";
ALTER TABLE "new_RiskAssessmentRecord" RENAME TO "RiskAssessmentRecord";
CREATE INDEX "RiskAssessmentRecord_incidentId_calculatedAtUtc_idx" ON "RiskAssessmentRecord"("incidentId", "calculatedAtUtc");
CREATE INDEX "RiskAssessmentRecord_deploymentId_calculatedAtUtc_idx" ON "RiskAssessmentRecord"("deploymentId", "calculatedAtUtc");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
