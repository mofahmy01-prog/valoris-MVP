/**
 * Milestone 3d acceptance harness — PurpleAir EPA correction through the API.
 *
 * npm run verify:m3d
 *
 * SIMULATION MODE — NOT FOR OPERATIONAL USE.
 */

export {}; // module scope

import { preflight, reportPreflight } from "./preflight";

const BASE = process.env["VALORIS_BASE_URL"] ?? "http://localhost:3000";
let failures = 0;

function check(label: string, passed: boolean, detail?: string): void {
  console.log(`  [${passed ? "PASS" : "FAIL"}] ${label}${detail === undefined ? "" : ` — ${detail}`}`);
  if (!passed) failures += 1;
}

function rule(c = "="): void {
  console.log(c.repeat(96));
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
    return text === "" ? { __status: r.status } : { ...(JSON.parse(text) as Json), __status: r.status };
  } catch {
    return { raw: text.slice(0, 300), __status: r.status };
  }
}

async function main(): Promise<void> {
  rule();
  console.log("VALORIS MILESTONE 3D VERIFICATION — PurpleAir EPA correction");
  rule();
  reportPreflight(await preflight(BASE));

  const created = await req("POST", "/api/incidents", {
    name: "purpleair correction check",
    centroidLat: 37.351,
    centroidLng: -122.052,
    callsigns: ["BRAVO-2"],
  });
  const incidentId = String((created["incident"] as Json)["id"]);
  await req("POST", `/api/incidents/${incidentId}/start`, {});

  const now = new Date().toISOString();
  const ch = (value: number) => ({ value, updatedAtUtc: now });

  async function post(
    purpleAir: Record<string, unknown> | undefined,
    plainPm25?: number,
  ): Promise<Json> {
    const environment: Record<string, unknown> = {
      ambientTempC: ch(34),
      humidityPct: ch(55),
      coPpm: ch(20),
    };
    if (purpleAir !== undefined) environment["purpleAir"] = purpleAir;
    if (plainPm25 !== undefined) environment["pm25UgM3"] = ch(plainPm25);

    return req("POST", `/api/incidents/${incidentId}/observations`, {
      actorLabel: "verify-m3d",
      observations: [
        {
          callsign: "BRAVO-2",
          recordedAtUtc: new Date().toISOString(),
          source: "simulated_atmos",
          vitals: { hrBpm: ch(130), spo2Pct: ch(95), fallDetected: false },
          environment,
          position: {
            lat: 37.35,
            lng: -122.05,
            escapeRouteStatus: "clear",
            scbaPressurePct: 70,
            scbaOnAir: true,
            wearingPpe: true,
            timeOnTaskMin: 10,
            fixUpdatedAtUtc: now,
            escapeRouteUpdatedAtUtc: now,
            scbaPressureUpdatedAtUtc: now,
          },
        },
      ],
    });
  }

  async function latestObservation(): Promise<Json> {
    const obs = await req("GET", `/api/incidents/${incidentId}/observations?limit=1`);
    return ((obs["observations"] as Array<Json>) ?? [])[0] as Json;
  }

  /* --- 1. Moderate smoke, US-wide regime -------------------------------- */
  console.log("\n1. Moderate smoke — raw cf_1 A=120 B=124 at 55% RH");
  await post({
    pm25_cf_1_a: 120,
    pm25_cf_1_b: 124,
    humidityPct: 55,
    temperatureC: 30,
    sensorId: "pa-demo-1",
  });
  let o = await latestObservation();
  console.log(
    `   raw ${String(o["pm25RawUgM3"])} -> corrected ${String(o["pm25CorrectedUgM3"])} ug/m3, regime ${String(o["pm25CorrectionRegime"])}, quality ${String(o["pm25QualityFlag"])}`,
  );
  check("raw retained", o["pm25RawUgM3"] === 122);
  check("corrected below raw — PurpleAir overreads", Number(o["pm25CorrectedUgM3"]) < 122);
  check("US-wide regime", o["pm25CorrectionRegime"] === "us_wide");
  check("quality good", o["pm25QualityFlag"] === "good");
  check("engine consumed the corrected value", o["pm25UgM3"] === o["pm25CorrectedUgM3"]);
  check("method recorded", o["pm25CorrectionMethod"] === "epa_us_wide_extended_v1");

  /* --- 2. Extreme smoke -------------------------------------------------- */
  console.log("\n2. Extreme wildfire smoke — raw cf_1 A=620 B=610");
  await post({
    pm25_cf_1_a: 620,
    pm25_cf_1_b: 610,
    humidityPct: 40,
    temperatureC: 38,
    sensorId: "pa-demo-1",
  });
  o = await latestObservation();
  console.log(
    `   raw ${String(o["pm25RawUgM3"])} -> corrected ${String(o["pm25CorrectedUgM3"])} ug/m3, regime ${String(o["pm25CorrectionRegime"])}`,
  );
  check("extreme smoke regime", o["pm25CorrectionRegime"] === "extreme_smoke");
  check("corrected well below raw", Number(o["pm25CorrectedUgM3"]) < 615);

  /* --- 3. Channel disagreement, rejected -> MISSING ---------------------- */
  console.log("\n3. Failing sensor — channels A=20 B=200 (disagreement beyond limit)");
  await post({
    pm25_cf_1_a: 20,
    pm25_cf_1_b: 200,
    humidityPct: 50,
    temperatureC: 30,
    sensorId: "pa-demo-1",
  });
  o = await latestObservation();
  console.log(
    `   raw ${String(o["pm25RawUgM3"])}, corrected ${String(o["pm25CorrectedUgM3"])}, quality ${String(o["pm25QualityFlag"])}, engine saw pm25UgM3=${String(o["pm25UgM3"])}`,
  );
  check("rejected", o["pm25QualityFlag"] === "rejected");
  check("corrected is null", o["pm25CorrectedUgM3"] === null);
  // The critical property: a rejected reading is MISSING, not zero, not raw.
  check("engine saw MISSING, not a number", o["pm25UgM3"] === null);
  check("raw still retained for debugging", o["pm25RawUgM3"] === 110);

  /* --- 4. Tier stays C for simulated data -------------------------------- */
  console.log("\n4. Data tier — simulated PurpleAir must not claim Tier A");
  o = await latestObservation();
  const tiers = o["dataTiers"] as Json;
  console.log(`   environment tier ${String(tiers["environment"])}, summary ${String(o["dataTierSummary"])}`);
  check(
    "simulated PurpleAir stays Tier C",
    tiers["environment"] === "C_SYNTHETIC_MODEL_DRIVEN",
  );

  /* --- 5. Real sensor data promotes to Tier A ---------------------------- */
  console.log("\n5. Data tier — a real PurpleAir reading promotes to Tier A");
  await post({
    pm25_cf_1_a: 90,
    pm25_cf_1_b: 92,
    humidityPct: 60,
    temperatureC: 28,
    sensorId: "pa-real-42",
    isRealSensorData: true,
  });
  o = await latestObservation();
  const realTiers = o["dataTiers"] as Json;
  console.log(`   environment tier ${String(realTiers["environment"])}, summary ${String(o["dataTierSummary"])}`);
  check("real reading is Tier A", realTiers["environment"] === "A_REAL_ENVIRONMENTAL");
  check("row summary shows mixed tiers", String(o["dataTierSummary"]).includes("A"));
  const prov = o["provenance"] as Json;
  const env = prov["environment"] as Json;
  check("attribution requirement recorded", String(env["licence"]).includes("attribution"));
  check(
    "known bias documented in provenance",
    String(env["modelRef"]).includes("12% underestimate"),
  );
  check(
    "unverified coefficients disclosed in provenance",
    String(env["modelRef"]).includes("UNVERIFIED"),
  );

  /* --- 6. Bad input rejected with 400 ------------------------------------ */
  console.log("\n6. Validation");
  const badChannel = await req("POST", `/api/incidents/${incidentId}/observations`, {
    actorLabel: "verify-m3d",
    observations: [
      {
        callsign: "BRAVO-2",
        recordedAtUtc: new Date().toISOString(),
        source: "simulated_atmos",
        vitals: { fallDetected: false },
        environment: {
          purpleAir: {
            pm25_cf_1_a: 50,
            pm25_atm_b: 50,
            humidityPct: 50,
            temperatureC: 20,
            sensorId: "pa",
          },
        },
        position: {
          lat: 37.35,
          lng: -122.05,
          escapeRouteStatus: "clear",
          timeOnTaskMin: 1,
        },
      },
    ],
  });
  check("the atm channel is rejected with 400", badChannel["__status"] === 400);

  await req("POST", `/api/incidents/${incidentId}/stop`, { actorLabel: "verify-m3d" });

  console.log();
  rule();
  console.log(failures === 0 ? "RESULT: ALL CHECKS PASSED" : `RESULT: ${failures} CHECK(S) FAILED`);
  rule();
  if (failures > 0) process.exitCode = 1;
}

main().catch((e: unknown) => {
  console.error(e);
  process.exitCode = 1;
});
