-- AlterTable
ALTER TABLE "Observation" ADD COLUMN "distanceToFireFrontUpdatedAtUtc" DATETIME;
ALTER TABLE "Observation" ADD COLUMN "distanceToSafeZoneUpdatedAtUtc" DATETIME;
ALTER TABLE "Observation" ADD COLUMN "escapeRouteUpdatedAtUtc" DATETIME;
ALTER TABLE "Observation" ADD COLUMN "positionFixUpdatedAtUtc" DATETIME;
ALTER TABLE "Observation" ADD COLUMN "scbaPressureUpdatedAtUtc" DATETIME;
