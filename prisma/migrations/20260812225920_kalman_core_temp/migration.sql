-- AlterTable
ALTER TABLE "Observation" ADD COLUMN "derivedCoreTempObserved" BOOLEAN;
ALTER TABLE "Observation" ADD COLUMN "derivedCoreTempSdC" REAL;
ALTER TABLE "Observation" ADD COLUMN "derivedCoreTempVarianceC2" REAL;
