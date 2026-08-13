/**
 * Verifies that a stored risk assessment can still be reconstructed after the
 * live profile and config have moved on.
 *
 * The defect this guards against: FirefighterProfile is mutable, so editing a
 * firefighter's age or conditions used to retroactively destroy the
 * reconstructability of every past assessment for that person — and the profile
 * is exactly what makes the score personalised.
 *
 * npm run verify:repro
 *
 * SIMULATION MODE — NOT FOR OPERATIONAL USE.
 */

export {}; // module scope

import { PrismaClient } from "@prisma/client";

import { preflight, reportPreflight } from "./preflight";

const BASE = process.env["VALORIS_BASE_URL"] ?? "http://localhost:3000";
let failures = 0;

function check(label: string, passed: boolean, detail?: string): void {
  console.log(`  [${passed ? "PASS" : "FAIL"}] ${label}${detail === undefined ? "" : ` — ${detail}`}`);
  if (!passed) failures += 1;
}

function rule(c = "="): void {
  console.log(c.repeat(90));
}

type Json = Record<string, unknown>;

async function req(method: string, path: string, body?: unknown): Promise<Json> {
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  try {
    return text === "" ? {} : (JSON.parse(text) as Json);
  } catch {
    return { raw: text.slice(0, 400), status: r.status };
  }
}

const prisma = new PrismaClient();

async function main(): Promise<void> {
  rule();
  console.log("VALORIS REPRODUCIBILITY VERIFICATION — profile and config snapshots");
  rule();
  reportPreflight(await preflight(BASE));

  const created = await req("POST", "/api/incidents", {
    name: "reproducibility check",
    centroidLat: 37.351,
    centroidLng: -122.052,
    callsigns: ["BRAVO-2"],
  });
  const incidentId = String((created["incident"] as Json)["id"]);
  await req("POST", `/api/incidents/${incidentId}/start`, {});

  const now = new Date().toISOString();
  const ch = (value: number) => ({ value, updatedAtUtc: now });
  await req("POST", `/api/incidents/${incidentId}/observations`, {
    actorLabel: "repro-check",
    observations: [
      {
        callsign: "BRAVO-2",
        recordedAtUtc: now,
        source: "simulated_wearable",
        vitals: { hrBpm: ch(140), spo2Pct: ch(94), fallDetected: false },
        environment: { ambientTempC: ch(36), humidityPct: ch(50), coPpm: ch(40) },
        position: {
          lat: 37.35,
          lng: -122.05,
          escapeRouteStatus: "clear",
          scbaPressurePct: 70,
          scbaOnAir: true,
          wearingPpe: true,
          timeOnTaskMin: 15,
          fixUpdatedAtUtc: now,
          escapeRouteUpdatedAtUtc: now,
          scbaPressureUpdatedAtUtc: now,
        },
      },
    ],
  });

  const before = await req("GET", `/api/incidents/${incidentId}/risks?latest=true`);
  const record = ((before["risks"] as Array<Json>) ?? [])[0] as Json;
  const repro = record["reproducibility"] as Json;
  const snapshot = repro["profileSnapshot"] as Json;

  console.log("\nAssessment stored. Profile snapshot captured with it:");
  console.log(`  callsign ${String(snapshot["callsign"])}, age ${String(snapshot["age"])}, fitness ${String(snapshot["fitness"])}, conditions ${JSON.stringify(snapshot["conditions"])}`);

  check("profile snapshot is stored", Object.keys(snapshot).length > 0);
  check("snapshot records the age actually scored", snapshot["age"] === 52);
  check(
    "risk config values are stored, not just a hash",
    Object.keys(repro["riskConfigValues"] as Json).length > 50,
  );
  check(
    "physiology config values are stored",
    Object.keys(repro["physiologyConfigValues"] as Json).length > 50,
  );

  /* --- Now mutate the live profile, exactly as a data edit would ---------- */
  const profile = await prisma.firefighterProfile.findFirst({
    where: { callsign: "BRAVO-2" },
  });
  if (profile === null) {
    console.log("BRAVO-2 not found");
    process.exitCode = 1;
    return;
  }
  const originalAge = profile.ageYears;
  const originalConditions = profile.conditionsJson;

  console.log(
    `\nMutating the live profile: age ${originalAge} -> 29, conditions -> [] ...`,
  );
  await prisma.firefighterProfile.update({
    where: { id: profile.id },
    data: { ageYears: 29, conditionsJson: JSON.stringify([]) },
  });

  const after = await req("GET", `/api/incidents/${incidentId}/risks?latest=true`);
  const recordAfter = ((after["risks"] as Array<Json>) ?? [])[0] as Json;
  const reproAfter = recordAfter["reproducibility"] as Json;
  const snapshotAfter = reproAfter["profileSnapshot"] as Json;

  console.log("Re-reading the SAME stored assessment:");
  console.log(`  snapshot age now reads ${String(snapshotAfter["age"])}, conditions ${JSON.stringify(snapshotAfter["conditions"])}`);

  check(
    "the stored snapshot still reports the age that was actually scored",
    snapshotAfter["age"] === 52,
    `got ${String(snapshotAfter["age"])}`,
  );
  check(
    "the stored snapshot still reports the conditions that were actually scored",
    JSON.stringify(snapshotAfter["conditions"]) === JSON.stringify(["moderate asthma"]),
    JSON.stringify(snapshotAfter["conditions"]),
  );
  check(
    "the stored score is unchanged by the profile edit",
    recordAfter["score"] === record["score"],
  );

  // Restore, so the edit does not leak into other harnesses.
  await prisma.firefighterProfile.update({
    where: { id: profile.id },
    data: { ageYears: originalAge, conditionsJson: originalConditions },
  });
  console.log("Live profile restored.");

  await req("POST", `/api/incidents/${incidentId}/stop`, { actorLabel: "repro-check" });

  console.log();
  rule();
  console.log(failures === 0 ? "RESULT: ALL CHECKS PASSED" : `RESULT: ${failures} CHECK(S) FAILED`);
  rule();
  if (failures > 0) process.exitCode = 1;
}

main()
  .catch((e: unknown) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
