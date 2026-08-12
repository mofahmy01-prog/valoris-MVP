/**
 * Shows the effect of an estimated core temperature on data-quality confidence.
 * Posts one fresh observation per firefighter, then reads the snapshot.
 *
 * npx tsx scripts/show-confidence.ts
 */

export {};

const BASE = process.env["VALORIS_BASE_URL"] ?? "http://localhost:3000";
const CALLSIGNS = ["ALPHA-1", "BRAVO-2", "CHARLIE-1"];

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
    return { raw: text.slice(0, 300), status: r.status };
  }
}

async function main(): Promise<void> {
  const created = await req("POST", "/api/incidents", {
    name: "confidence demonstration",
    centroidLat: 37.351,
    centroidLng: -122.052,
  });
  const id = String((created["incident"] as Json)["id"]);
  await req("POST", `/api/incidents/${id}/start`, {});

  const now = new Date().toISOString();
  const ch = (value: number) => ({ value, updatedAtUtc: now });

  await req("POST", `/api/incidents/${id}/observations`, {
    actorLabel: "confidence-demo",
    observations: CALLSIGNS.map((callsign) => ({
      callsign,
      recordedAtUtc: now,
      source: "simulated_wearable",
      vitals: {
        hrBpm: ch(120),
        spo2Pct: ch(97),
        respRatePerMin: ch(18),
        hydrationPct: ch(85),
        fallDetected: false,
      },
      environment: {
        ambientTempC: ch(24),
        humidityPct: ch(45),
        coPpm: ch(6),
        pm25UgM3: ch(15),
        windSpeedMs: ch(3),
        windDirDeg: ch(200),
      },
      position: {
        lat: 37.36,
        lng: -122.06,
        distanceToSafeZoneM: 150,
        escapeRouteStatus: "clear",
        scbaPressurePct: 90,
        scbaOnAir: true,
        wearingPpe: true,
        timeOnTaskMin: 8,
        fixUpdatedAtUtc: now,
        escapeRouteUpdatedAtUtc: now,
        distanceToSafeZoneUpdatedAtUtc: now,
        scbaPressureUpdatedAtUtc: now,
      },
    })),
  });

  const snapshot = await req("GET", `/api/incidents/${id}/snapshot`);
  console.log(
    "Fresh observations, quiet conditions, core temperature ESTIMATED (never measured):\n",
  );
  console.log(
    `${"callsign".padEnd(11)}${"band".padEnd(10)}${"score".padStart(6)}  ${"confidence".padEnd(11)}${"coreTemp".padStart(9)}${"sd".padStart(8)}  observed`,
  );
  for (const f of (snapshot["firefighters"] as Array<Json>) ?? []) {
    const risk = f["risk"] as Json | null;
    const phys = f["physiology"] as Json | null;
    if (risk === null || phys === null) continue;
    const dq = risk["dataQuality"] as Json;
    console.log(
      `${String(f["callsign"]).padEnd(11)}${String(risk["band"]).padEnd(10)}${String(risk["score"]).padStart(6)}  ${String(dq["confidence"]).padEnd(11)}${String(phys["coreTempC"]).padStart(9)}${String(phys["coreTempSdC"]).padStart(8)}  ${String(phys["coreTempObserved"])}`,
    );
  }
  console.log(
    "\nConfidence caps at medium because core temperature is modelled, not measured.",
  );
  await req("POST", `/api/incidents/${id}/stop`, { actorLabel: "confidence-demo" });
}

main().catch((e: unknown) => {
  console.error(e);
  process.exitCode = 1;
});
