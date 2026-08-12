/**
 * Milestone 3b acceptance harness. Drives the running HTTP API.
 *
 * Posts identical raw readings for all six firefighters across several ticks and
 * shows the physiology models diverging — core temperature, fatigue and
 * allowable duration are produced, not supplied.
 *
 * Start the app first, then: npm run verify:m3b
 *
 * SIMULATION MODE — NOT FOR OPERATIONAL USE.
 */

export {}; // module scope, so top-level names do not collide with sibling scripts

const BASE = process.env["VALORIS_BASE_URL"] ?? "http://localhost:3000";
const CALLSIGNS = ["ALPHA-1", "ALPHA-2", "BRAVO-1", "BRAVO-2", "CHARLIE-1", "CHARLIE-2"];
const TICKS = 6;
const TICK_MINUTES = 5;

let failures = 0;

function check(label: string, passed: boolean, detail?: string): void {
  console.log(`  [${passed ? "PASS" : "FAIL"}] ${label}${detail === undefined ? "" : ` — ${detail}`}`);
  if (!passed) failures += 1;
}

function rule(c = "="): void {
  console.log(c.repeat(104));
}

type Json = Record<string, unknown>;

async function req(method: string, path: string, body?: unknown): Promise<{ status: number; json: Json }> {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let json: Json = {};
  try {
    json = text === "" ? {} : (JSON.parse(text) as Json);
  } catch {
    json = { raw: text.slice(0, 800) };
  }
  return { status: response.status, json };
}

/** Identical raw readings for every firefighter at every tick. */
function observationFor(callsign: string, atIso: string) {
  const channel = (value: number) => ({ value, updatedAtUtc: atIso });
  return {
    callsign,
    recordedAtUtc: atIso,
    source: "simulated_wearable" as const,
    vitals: {
      hrBpm: channel(148),
      spo2Pct: channel(93),
      // A wearable also reports a core temperature. The model must ignore it.
      coreTempC: channel(38.2),
      respRatePerMin: channel(26),
      fatiguePct: channel(45),
      hydrationPct: channel(68),
      fallDetected: false,
    },
    environment: {
      ambientTempC: channel(42),
      humidityPct: channel(55),
      coPpm: channel(90),
      pm25UgM3: channel(160),
      windSpeedMs: channel(4),
      windDirDeg: channel(240),
    },
    position: {
      lat: 37.3508,
      lng: -122.0498,
      distanceToSafeZoneM: 200,
      escapeRouteStatus: "clear" as const,
      scbaPressurePct: 60,
      scbaOnAir: true,
      wearingPpe: true,
      timeOnTaskMin: 10,
      fixUpdatedAtUtc: atIso,
      escapeRouteUpdatedAtUtc: atIso,
      distanceToSafeZoneUpdatedAtUtc: atIso,
      scbaPressureUpdatedAtUtc: atIso,
    },
  };
}

async function main(): Promise<void> {
  rule();
  console.log("VALORIS MILESTONE 3B VERIFICATION — physiology wired into the pipeline");
  console.log(`base ${BASE}`);
  rule();

  const created = await req("POST", "/api/incidents", {
    name: "3b physiology pipeline",
    scenarioKey: "baseline_wildfire",
    centroidLat: 37.351,
    centroidLng: -122.052,
  });
  const incident = created.json["incident"] as Json | undefined;
  const incidentId = typeof incident?.["id"] === "string" ? incident["id"] : null;
  check("incident created", created.status === 201 && incidentId !== null);
  if (incidentId === null) {
    process.exitCode = 1;
    return;
  }
  await req("POST", `/api/incidents/${incidentId}/start`, {});

  console.log(
    `\nPosting ${TICKS} ticks, ${TICK_MINUTES} min apart, IDENTICAL raw readings for all six:`,
  );
  console.log(
    "  HR 148 bpm · SpO2 93% · ambient 42 C · humidity 55% · CO 90 ppm · PM2.5 160 · SCBA 60% on air · PPE worn",
  );
  console.log("  the wearable also reports core temp 38.2 C and fatigue 45% — both must be ignored\n");

  const startMs = Date.now() - TICKS * TICK_MINUTES * 60_000;
  const trajectory = new Map<string, Array<{ coreTempC: number; fatiguePct: number; score: number; band: string; dlimMin: number | null }>>();
  for (const c of CALLSIGNS) trajectory.set(c, []);

  for (let tick = 0; tick < TICKS; tick += 1) {
    const atIso = new Date(startMs + tick * TICK_MINUTES * 60_000).toISOString();
    const response = await req("POST", `/api/incidents/${incidentId}/observations`, {
      actorLabel: "verify-m3b",
      observations: CALLSIGNS.map((c) => observationFor(c, atIso)),
    });
    if (response.status !== 201) {
      check(`tick ${tick + 1} accepted`, false, JSON.stringify(response.json).slice(0, 400));
      process.exitCode = 1;
      return;
    }
    for (const r of (response.json["results"] as Array<Json>) ?? []) {
      const phys = r["physiology"] as Json;
      trajectory.get(String(r["callsign"]))?.push({
        coreTempC: Number(phys["coreTempC"]),
        fatiguePct: Number(phys["fatiguePct"]),
        score: Number(r["score"]),
        band: String(r["band"]),
        dlimMin: phys["dlimMin"] === null ? null : Number(phys["dlimMin"]),
      });
    }
  }
  check("all ticks accepted", true);

  /* --- Core temperature trajectory -------------------------------------- */
  rule("-");
  console.log("MODELLED CORE TEMPERATURE, C — wearable said 38.2 at every tick");
  rule("-");
  console.log(`${"callsign".padEnd(11)}${Array.from({ length: TICKS }, (_, i) => `t${i + 1}`.padStart(8)).join("")}`);
  for (const c of CALLSIGNS) {
    const row = trajectory.get(c) ?? [];
    console.log(`${c.padEnd(11)}${row.map((v) => v.coreTempC.toFixed(2).padStart(8)).join("")}`);
  }

  rule("-");
  console.log("MODELLED FATIGUE, % — wearable said 45 at every tick");
  rule("-");
  console.log(`${"callsign".padEnd(11)}${Array.from({ length: TICKS }, (_, i) => `t${i + 1}`.padStart(8)).join("")}`);
  for (const c of CALLSIGNS) {
    const row = trajectory.get(c) ?? [];
    console.log(`${c.padEnd(11)}${row.map((v) => v.fatiguePct.toFixed(1).padStart(8)).join("")}`);
  }

  rule("-");
  console.log("RISK SCORE");
  rule("-");
  console.log(`${"callsign".padEnd(11)}${Array.from({ length: TICKS }, (_, i) => `t${i + 1}`.padStart(8)).join("")}   final band`);
  for (const c of CALLSIGNS) {
    const row = trajectory.get(c) ?? [];
    const last = row[row.length - 1];
    console.log(
      `${c.padEnd(11)}${row.map((v) => v.score.toFixed(1).padStart(8)).join("")}   ${last?.band ?? "-"}`,
    );
  }

  rule("-");
  console.log("ALLOWABLE DURATION FROM THE REDUCED PHS MODEL, min");
  rule("-");
  console.log(`${"callsign".padEnd(11)}${Array.from({ length: TICKS }, (_, i) => `t${i + 1}`.padStart(8)).join("")}`);
  for (const c of CALLSIGNS) {
    const row = trajectory.get(c) ?? [];
    console.log(
      `${c.padEnd(11)}${row.map((v) => (v.dlimMin === null ? "  none".padStart(8) : v.dlimMin.toFixed(1).padStart(8))).join("")}`,
    );
  }
  console.log();

  /* --- Assertions -------------------------------------------------------- */
  const finals = CALLSIGNS.map((c) => {
    const row = trajectory.get(c) ?? [];
    return { callsign: c, ...(row[row.length - 1] as { coreTempC: number; fatiguePct: number; score: number; band: string }) };
  });

  const distinctScores = new Set(finals.map((f) => f.score));
  check("six distinct scores from identical raw readings", distinctScores.size === 6, `${distinctScores.size} distinct`);

  // The published Kalman estimator is heart-rate-only, so identical heart rates
  // give identical core temperature estimates. Personalisation of core
  // temperature lives in the LIMITS it is compared against, not the estimate.
  // See docs/KNOWN_LIMITATIONS.md items 25 and 26.
  const distinctCore = new Set(finals.map((f) => f.coreTempC));
  check(
    "core temperature is identical across profiles — the estimator is HR-only",
    distinctCore.size === 1,
    `${distinctCore.size} distinct`,
  );

  const distinctFatigue = new Set(finals.map((f) => f.fatiguePct));
  check("fatigue differs across profiles", distinctFatigue.size > 1, `${distinctFatigue.size} distinct`);

  check(
    "no modelled core temperature equals the value the wearable reported",
    finals.every((f) => f.coreTempC !== 38.2),
  );
  check(
    "no modelled fatigue equals the value the wearable reported",
    finals.every((f) => f.fatiguePct !== 45),
  );

  for (const c of CALLSIGNS) {
    const row = trajectory.get(c) ?? [];
    const rising =
      row.length > 1 && (row[row.length - 1] as { coreTempC: number }).coreTempC >= (row[0] as { coreTempC: number }).coreTempC;
    check(`${c} core temperature accumulates across ticks`, rising);
  }

  const alpha1 = finals.find((f) => f.callsign === "ALPHA-1");
  const bravo2 = finals.find((f) => f.callsign === "BRAVO-2");
  check(
    "the 52-year-old asthmatic scores above the 28-year-old",
    (bravo2?.score ?? 0) > (alpha1?.score ?? 0),
    `BRAVO-2 ${bravo2?.score} vs ALPHA-1 ${alpha1?.score}`,
  );

  /* --- The snapshot exposes the derivation ------------------------------- */
  const snapshot = await req("GET", `/api/incidents/${incidentId}/snapshot`);
  const ffs = (snapshot.json["firefighters"] as Array<Json>) ?? [];
  const sample = ffs.find((f) => f["callsign"] === "BRAVO-2");
  const samplePhys = sample?.["physiology"] as Json | undefined;
  check("snapshot exposes derived physiology", samplePhys !== undefined);
  check("snapshot marks core temperature as modelled", samplePhys?.["coreTempIsModelled"] === true);
  check(
    "snapshot keeps the reported sensor value alongside the model's",
    samplePhys?.["reportedCoreTempC"] === 38.2,
  );
  console.log("\n  BRAVO-2 derived physiology from the snapshot:");
  console.log(`  ${JSON.stringify(samplePhys, null, 2).split("\n").join("\n  ")}`);

  await req("POST", `/api/incidents/${incidentId}/stop`, { actorLabel: "verify-m3b" });

  console.log();
  rule();
  console.log(failures === 0 ? "RESULT: ALL CHECKS PASSED" : `RESULT: ${failures} CHECK(S) FAILED`);
  console.log(`incident ${incidentId}`);
  rule();
  if (failures > 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
