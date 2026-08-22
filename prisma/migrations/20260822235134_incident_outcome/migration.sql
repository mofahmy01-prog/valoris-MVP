-- CreateTable
CREATE TABLE "IncidentOutcome" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "incidentId" TEXT NOT NULL,
    "deploymentId" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "interventionOccurred" BOOLEAN,
    "notes" TEXT,
    "recordedAtUtc" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recordedBy" TEXT NOT NULL,
    CONSTRAINT "IncidentOutcome_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "IncidentOutcome_deploymentId_fkey" FOREIGN KEY ("deploymentId") REFERENCES "Deployment" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "IncidentOutcome_deploymentId_key" ON "IncidentOutcome"("deploymentId");

-- CreateIndex
CREATE INDEX "IncidentOutcome_incidentId_idx" ON "IncidentOutcome"("incidentId");

-- CreateIndex
CREATE INDEX "IncidentOutcome_outcome_idx" ON "IncidentOutcome"("outcome");
