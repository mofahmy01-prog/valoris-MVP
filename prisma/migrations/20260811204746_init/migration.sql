-- CreateTable
CREATE TABLE "Organisation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "createdAtUtc" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "FirefighterProfile" (
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
    "createdAtUtc" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAtUtc" DATETIME NOT NULL,
    CONSTRAINT "FirefighterProfile_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Incident" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organisationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "scenarioKey" TEXT NOT NULL,
    "fireProviderKey" TEXT NOT NULL,
    "centroidLat" REAL NOT NULL,
    "centroidLng" REAL NOT NULL,
    "modelVersion" TEXT NOT NULL,
    "configHash" TEXT NOT NULL,
    "createdAtUtc" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAtUtc" DATETIME,
    "stoppedAtUtc" DATETIME,
    CONSTRAINT "Incident_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Crew" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "incidentId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    CONSTRAINT "Crew_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Deployment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "incidentId" TEXT NOT NULL,
    "crewId" TEXT NOT NULL,
    "firefighterProfileId" TEXT NOT NULL,
    "sector" TEXT,
    "assignedAtUtc" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releasedAtUtc" DATETIME,
    CONSTRAINT "Deployment_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Deployment_crewId_fkey" FOREIGN KEY ("crewId") REFERENCES "Crew" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Deployment_firefighterProfileId_fkey" FOREIGN KEY ("firefighterProfileId") REFERENCES "FirefighterProfile" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Observation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "incidentId" TEXT NOT NULL,
    "deploymentId" TEXT NOT NULL,
    "recordedAtUtc" DATETIME NOT NULL,
    "source" TEXT NOT NULL,
    "hrBpm" REAL,
    "spo2Pct" REAL,
    "coreTempC" REAL,
    "respRatePerMin" REAL,
    "fatiguePct" REAL,
    "hydrationPct" REAL,
    "fallDetected" BOOLEAN NOT NULL DEFAULT false,
    "hrUpdatedAtUtc" DATETIME,
    "spo2UpdatedAtUtc" DATETIME,
    "coreTempUpdatedAtUtc" DATETIME,
    "respRateUpdatedAtUtc" DATETIME,
    "fatigueUpdatedAtUtc" DATETIME,
    "hydrationUpdatedAtUtc" DATETIME,
    "ambientTempC" REAL,
    "humidityPct" REAL,
    "coPpm" REAL,
    "pm25UgM3" REAL,
    "windSpeedMs" REAL,
    "windDirDeg" REAL,
    "ambientTempUpdatedAtUtc" DATETIME,
    "humidityUpdatedAtUtc" DATETIME,
    "coUpdatedAtUtc" DATETIME,
    "pm25UpdatedAtUtc" DATETIME,
    "windSpeedUpdatedAtUtc" DATETIME,
    "windDirUpdatedAtUtc" DATETIME,
    "lat" REAL NOT NULL,
    "lng" REAL NOT NULL,
    "distanceToFireFrontM" REAL,
    "distanceToSafeZoneM" REAL,
    "escapeRouteStatus" TEXT NOT NULL,
    "scbaPressurePct" REAL,
    "scbaOnAir" BOOLEAN NOT NULL DEFAULT true,
    "timeOnTaskMin" REAL NOT NULL,
    "manualMaydayActive" BOOLEAN NOT NULL DEFAULT false,
    "fireProviderKey" TEXT,
    "fireFrontConfidence" TEXT,
    CONSTRAINT "Observation_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Observation_deploymentId_fkey" FOREIGN KEY ("deploymentId") REFERENCES "Deployment" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RiskAssessmentRecord" (
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
    CONSTRAINT "RiskAssessmentRecord_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "RiskAssessmentRecord_deploymentId_fkey" FOREIGN KEY ("deploymentId") REFERENCES "Deployment" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "RiskAssessmentRecord_observationId_fkey" FOREIGN KEY ("observationId") REFERENCES "Observation" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Recommendation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "incidentId" TEXT NOT NULL,
    "deploymentId" TEXT NOT NULL,
    "riskAssessmentRecordId" TEXT,
    "type" TEXT NOT NULL,
    "priorityRank" INTEGER NOT NULL,
    "rationale" TEXT NOT NULL,
    "suggestedAction" TEXT NOT NULL,
    "alternativesJson" TEXT NOT NULL,
    "confidence" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "createdAtUtc" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAtUtc" DATETIME NOT NULL,
    "resolvedAtUtc" DATETIME,
    CONSTRAINT "Recommendation_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Recommendation_deploymentId_fkey" FOREIGN KEY ("deploymentId") REFERENCES "Deployment" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Recommendation_riskAssessmentRecordId_fkey" FOREIGN KEY ("riskAssessmentRecordId") REFERENCES "RiskAssessmentRecord" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CommanderAction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "incidentId" TEXT NOT NULL,
    "recommendationId" TEXT,
    "action" TEXT NOT NULL,
    "reasonText" TEXT,
    "actorLabel" TEXT NOT NULL,
    "createdAtUtc" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CommanderAction_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CommanderAction_recommendationId_fkey" FOREIGN KEY ("recommendationId") REFERENCES "Recommendation" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "incidentId" TEXT,
    "occurredAtUtc" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "eventType" TEXT NOT NULL,
    "actorLabel" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "detailJson" TEXT NOT NULL,
    CONSTRAINT "AuditEvent_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "FirefighterProfile_organisationId_idx" ON "FirefighterProfile"("organisationId");

-- CreateIndex
CREATE UNIQUE INDEX "FirefighterProfile_organisationId_callsign_key" ON "FirefighterProfile"("organisationId", "callsign");

-- CreateIndex
CREATE INDEX "Incident_organisationId_idx" ON "Incident"("organisationId");

-- CreateIndex
CREATE INDEX "Crew_incidentId_idx" ON "Crew"("incidentId");

-- CreateIndex
CREATE UNIQUE INDEX "Crew_incidentId_name_key" ON "Crew"("incidentId", "name");

-- CreateIndex
CREATE INDEX "Deployment_incidentId_idx" ON "Deployment"("incidentId");

-- CreateIndex
CREATE INDEX "Deployment_crewId_idx" ON "Deployment"("crewId");

-- CreateIndex
CREATE UNIQUE INDEX "Deployment_incidentId_firefighterProfileId_key" ON "Deployment"("incidentId", "firefighterProfileId");

-- CreateIndex
CREATE INDEX "Observation_incidentId_recordedAtUtc_idx" ON "Observation"("incidentId", "recordedAtUtc");

-- CreateIndex
CREATE INDEX "Observation_deploymentId_recordedAtUtc_idx" ON "Observation"("deploymentId", "recordedAtUtc");

-- CreateIndex
CREATE INDEX "RiskAssessmentRecord_incidentId_calculatedAtUtc_idx" ON "RiskAssessmentRecord"("incidentId", "calculatedAtUtc");

-- CreateIndex
CREATE INDEX "RiskAssessmentRecord_deploymentId_calculatedAtUtc_idx" ON "RiskAssessmentRecord"("deploymentId", "calculatedAtUtc");

-- CreateIndex
CREATE INDEX "Recommendation_incidentId_status_idx" ON "Recommendation"("incidentId", "status");

-- CreateIndex
CREATE INDEX "Recommendation_deploymentId_idx" ON "Recommendation"("deploymentId");

-- CreateIndex
CREATE INDEX "CommanderAction_incidentId_createdAtUtc_idx" ON "CommanderAction"("incidentId", "createdAtUtc");

-- CreateIndex
CREATE INDEX "CommanderAction_recommendationId_idx" ON "CommanderAction"("recommendationId");

-- CreateIndex
CREATE INDEX "AuditEvent_incidentId_occurredAtUtc_idx" ON "AuditEvent"("incidentId", "occurredAtUtc");

-- CreateIndex
CREATE INDEX "AuditEvent_eventType_idx" ON "AuditEvent"("eventType");

-- ---------------------------------------------------------------------------
-- Append-only enforcement.
--
-- The build spec requires Observation to be append-only and AuditEvent to
-- expose no update or delete path. Application-layer discipline is not enough
-- for an audit trail, so the database refuses both operations outright.
-- ---------------------------------------------------------------------------

CREATE TRIGGER "Observation_no_update"
BEFORE UPDATE ON "Observation"
BEGIN
  SELECT RAISE(ABORT, 'Observation is append-only: UPDATE is not permitted');
END;

CREATE TRIGGER "Observation_no_delete"
BEFORE DELETE ON "Observation"
BEGIN
  SELECT RAISE(ABORT, 'Observation is append-only: DELETE is not permitted');
END;

CREATE TRIGGER "AuditEvent_no_update"
BEFORE UPDATE ON "AuditEvent"
BEGIN
  SELECT RAISE(ABORT, 'AuditEvent is append-only: UPDATE is not permitted');
END;

CREATE TRIGGER "AuditEvent_no_delete"
BEFORE DELETE ON "AuditEvent"
BEGIN
  SELECT RAISE(ABORT, 'AuditEvent is append-only: DELETE is not permitted');
END;

-- A reject or override must carry a non-empty, non-whitespace reason. Enforced
-- here as well as by Zod at the API boundary, so no code path can bypass it.
CREATE TRIGGER "CommanderAction_reason_required_insert"
BEFORE INSERT ON "CommanderAction"
WHEN NEW."action" IN ('reject', 'override')
     AND (NEW."reasonText" IS NULL OR TRIM(NEW."reasonText") = '')
BEGIN
  SELECT RAISE(ABORT, 'A reject or override requires a non-empty reason');
END;
