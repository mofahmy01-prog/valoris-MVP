/**
 * Milestone 2 acceptance harness. Drives the running HTTP API — no mocks.
 *
 * Start the app first, then: npm run verify:m2
 *
 * SIMULATION MODE — NOT FOR OPERATIONAL USE.
 */

export {}; // module scope, so top-level names do not collide with sibling scripts

const BASE = process.env["VALORIS_BASE_URL"] ?? "http://localhost:3000";

let failures = 0;

function check(label: string, passed: boolean, detail?: string): void {
  console.log(`  [${passed ? "PASS" : "FAIL"}] ${label}${detail === undefined ? "" : ` — ${detail}`}`);
  if (!passed) failures += 1;
}

function rule(c = "="): void {
  console.log(c.repeat(78));
}

type Json = Record<string, unknown>;

async function req(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; json: Json }> {
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
    json = { raw: text };
  }
  return { status: response.status, json };
}

const CENTROID = { lat: 37.351, lng: -122.052 };

function isoAt(offsetSec: number): string {
  return new Date(Date.now() + offsetSec * 1000).toISOString();
}

function channel(value: number | null, ageSec = 0) {
  return { value, updatedAtUtc: isoAt(-ageSec) };
}

async function main(): Promise<void> {
  rule();
  console.log("VALORIS MILESTONE 2 VERIFICATION");
  console.log(`base ${BASE}`);
  rule();

  /* ---------------------------------------------------------------------- */
  // Guard integrity comes FIRST and is read-only. If a migration has dropped a
  // trigger, that must be the loudest thing in the output — not a line buried
  // two hundred lines down. This check never repairs; `npm run seed` and
  // `npm run migrate` do that. Detection and repair are kept separate so the
  // report always states what was actually true when it ran.
  console.log("\n0. DATABASE GUARD INTEGRITY (read-only)");
  {
    const { PrismaClient } = await import("@prisma/client");
    const { verifyDatabaseGuards, DATABASE_GUARDS } = await import(
      "../lib/db/guards"
    );
    const guardPrisma = new PrismaClient();
    try {
      const result = await verifyDatabaseGuards(guardPrisma);
      console.log(`  installed: ${result.installed.join(", ") || "(none)"}`);
      if (!result.ok) {
        console.log("");
        console.log("!".repeat(78));
        console.log(
          `  GUARD INTEGRITY FAILURE — ${result.missing.length} of ${DATABASE_GUARDS.length} guard(s) ABSENT:`,
        );
        for (const name of result.missing) console.log(`    - ${name}`);
        console.log(
          "  The append-only guarantee is NOT enforced. Run `npm run migrate` or `npm run seed`.",
        );
        console.log("  See docs/KNOWN_LIMITATIONS.md item 22.");
        console.log("!".repeat(78));
        console.log("");
      }
      for (const guard of DATABASE_GUARDS) {
        check(
          `guard ${guard.name} present`,
          result.installed.includes(guard.name),
          guard.purpose,
        );
      }
    } finally {
      await guardPrisma.$disconnect();
    }
  }

  /* ---------------------------------------------------------------------- */
  console.log("\n1. GET /api/health");
  const health = await req("GET", "/api/health");
  console.log(JSON.stringify(health.json, null, 2));
  check("returns 200", health.status === 200);
  check("declares simulation only", health.json["simulationOnly"] === true);
  check("declares not clinically validated", health.json["clinicallyValidated"] === false);
  check("lists three fire front providers", Array.isArray(health.json["fireFrontProviders"]) && (health.json["fireFrontProviders"] as unknown[]).length === 3);

  /* ---------------------------------------------------------------------- */
  console.log("\n2. POST /api/incidents");
  const created = await req("POST", "/api/incidents", {
    name: "Verification wildfire",
    scenarioKey: "baseline_wildfire",
    centroidLat: CENTROID.lat,
    centroidLng: CENTROID.lng,
  });
  console.log(JSON.stringify(created.json, null, 2));
  check("returns 201", created.status === 201);
  const incident = created.json["incident"] as Json | undefined;
  const incidentId = typeof incident?.["id"] === "string" ? incident["id"] : null;
  check("returns an incident id", incidentId !== null);
  check("deploys six firefighters", Array.isArray(created.json["deployedCallsigns"]) && (created.json["deployedCallsigns"] as unknown[]).length === 6);
  if (incidentId === null) {
    console.log("\nCannot continue without an incident id.");
    process.exitCode = 1;
    return;
  }

  console.log("\n2b. POST /api/incidents with a bad body (expect 400)");
  const badIncident = await req("POST", "/api/incidents", {
    name: "",
    centroidLat: 999,
    centroidLng: -122,
  });
  console.log(`  status ${badIncident.status}`);
  console.log(`  ${JSON.stringify(badIncident.json["details"])}`);
  check("rejects an invalid body with 400", badIncident.status === 400);

  /* ---------------------------------------------------------------------- */
  console.log("\n3. POST /api/incidents/[id]/start");
  const started = await req("POST", `/api/incidents/${incidentId}/start`, {
    actorLabel: "verification-harness",
  });
  console.log(JSON.stringify(started.json, null, 2));
  check("returns 200", started.status === 200);
  check("status is running", ((started.json["incident"] as Json)?.["status"]) === "running");

  /* ---------------------------------------------------------------------- */
  console.log("\n4. GET /api/incidents/[id]");
  const detail = await req("GET", `/api/incidents/${incidentId}`);
  const deployments = detail.json["deployments"] as Array<Json> | undefined;
  check("returns 200", detail.status === 200);
  check("has six deployments", deployments?.length === 6);
  console.log("  distinct profiles:");
  for (const d of deployments ?? []) {
    const ff = d["firefighter"] as Json;
    console.log(
      `    ${String(ff["callsign"]).padEnd(10)} age ${String(ff["ageYears"]).padStart(2)}  ${String(ff["fitness"]).padEnd(8)} resp:${String(ff["respiratoryRisk"]).padEnd(8)} heat:${String(ff["heatTolerance"]).padEnd(4)} conditions:${JSON.stringify(ff["conditions"])}`,
    );
  }
  const provider = detail.json["fireFrontProvider"] as Json;
  console.log(`  fire provider: ${String(provider["label"])} (available ${String(provider["available"])})`);
  check("declares Valoris does not model fire behaviour", provider["valorisModelsFireBehaviour"] === false);

  /* ---------------------------------------------------------------------- */
  console.log("\n5. POST /api/incidents/[id]/observations — identical vitals, six profiles");
  const identicalVitals = {
    hrBpm: channel(148),
    spo2Pct: channel(93),
    coreTempC: channel(38.2),
    respRatePerMin: channel(26),
    fatiguePct: channel(45),
    hydrationPct: channel(68),
    fallDetected: false,
  };
  const identicalEnv = {
    ambientTempC: channel(38),
    humidityPct: channel(55),
    coPpm: channel(60),
    pm25UgM3: channel(140),
    windSpeedMs: channel(7),
    windDirDeg: channel(240),
  };
  const callsigns = ["ALPHA-1", "ALPHA-2", "BRAVO-1", "BRAVO-2", "CHARLIE-1", "CHARLIE-2"];

  const ingest = await req("POST", `/api/incidents/${incidentId}/observations`, {
    actorLabel: "verification-harness",
    observations: callsigns.map((callsign) => ({
      callsign,
      recordedAtUtc: isoAt(0),
      source: "simulated_wearable",
      vitals: identicalVitals,
      environment: identicalEnv,
      position: {
        lat: 37.3505,
        lng: -122.0495,
        escapeRouteStatus: "clear",
        scbaPressurePct: 52,
        scbaOnAir: true,
        timeOnTaskMin: 28,
      },
    })),
  });
  check("returns 201", ingest.status === 201);
  check("ingested six", ingest.json["ingested"] === 6);
  const front = ingest.json["fireFront"] as Json;
  console.log(`  fire front: ${JSON.stringify(front, null, 2)}`);
  check(
    "front is labelled NOT a fire behaviour prediction",
    front["isFireBehaviourPrediction"] === false,
  );
  console.log("  results (identical vitals, distance derived from the provider):");
  for (const r of (ingest.json["results"] as Array<Json>) ?? []) {
    console.log(
      `    ${String(r["callsign"]).padEnd(10)} score ${String(r["score"]).padStart(5)}  band ${String(r["band"]).padEnd(9)} confidence ${String(r["confidence"]).padEnd(6)} distToFront ${String(r["distanceToFireFrontM"])} m`,
    );
  }
  const scores = ((ingest.json["results"] as Array<Json>) ?? []).map((r) => Number(r["score"]));
  check("scores differ across profiles", new Set(scores).size > 1, `${new Set(scores).size} distinct values`);

  /* ---------------------------------------------------------------------- */
  console.log("\n6. GET /api/incidents/[id]/snapshot");
  const snapshot = await req("GET", `/api/incidents/${incidentId}/snapshot`);
  const ffs = snapshot.json["firefighters"] as Array<Json> | undefined;
  check("returns 200", snapshot.status === 200);
  check("has six firefighters", ffs?.length === 6);
  check("every firefighter has a risk assessment", (ffs ?? []).every((f) => f["risk"] !== null));
  const sample = (ffs ?? []).find((f) => f["callsign"] === "BRAVO-2");
  console.log("  BRAVO-2 snapshot:");
  console.log(JSON.stringify(sample?.["risk"], null, 2));

  /* ---------------------------------------------------------------------- */
  console.log("\n7. Sensor dropout — HR not refreshed for 180 s");
  const dropout = await req("POST", `/api/incidents/${incidentId}/observations`, {
    actorLabel: "verification-harness",
    observations: [
      {
        callsign: "ALPHA-1",
        recordedAtUtc: isoAt(0),
        source: "simulated_wearable",
        vitals: {
          ...identicalVitals,
          hrBpm: channel(148, 180),
          spo2Pct: channel(98),
          coreTempC: channel(37.0),
          fatiguePct: channel(10),
        },
        environment: {
          ambientTempC: channel(21),
          humidityPct: channel(40),
          coPpm: channel(3),
          pm25UgM3: channel(10),
          windSpeedMs: channel(2),
          windDirDeg: channel(180),
        },
        position: {
          lat: 37.40,
          lng: -122.10,
          escapeRouteStatus: "clear",
          scbaPressurePct: 92,
          scbaOnAir: true,
          timeOnTaskMin: 4,
        },
      },
    ],
  });
  const dropoutResult = ((dropout.json["results"] as Array<Json>) ?? [])[0];
  console.log(`  ${JSON.stringify(dropoutResult, null, 2)}`);
  check("band moved to UNKNOWN", dropoutResult?.["band"] === "UNKNOWN");
  check("confidence dropped to low", dropoutResult?.["confidence"] === "low");
  check("band transition was recorded", dropoutResult?.["previousBand"] !== dropoutResult?.["band"]);

  /* ---------------------------------------------------------------------- */
  console.log("\n8. GET /api/incidents/[id]/risks?latest=true");
  const risks = await req("GET", `/api/incidents/${incidentId}/risks?latest=true`);
  check("returns 200", risks.status === 200);
  const riskRows = risks.json["risks"] as Array<Json> | undefined;
  check("one row per firefighter", riskRows?.length === 6);
  for (const r of riskRows ?? []) {
    console.log(
      `    ${String(r["callsign"]).padEnd(10)} band ${String(r["band"]).padEnd(9)} score ${String(r["score"] ?? "-")}`,
    );
  }

  /* ---------------------------------------------------------------------- */
  console.log("\n9. GET /api/incidents/[id]/stream (SSE)");
  const controller = new AbortController();
  const streamTimer = setTimeout(() => controller.abort(), 6000);
  const events: string[] = [];
  try {
    const response = await fetch(`${BASE}/api/incidents/${incidentId}/stream`, {
      signal: controller.signal,
    });
    check("returns 200", response.status === 200);
    check(
      "content type is text/event-stream",
      (response.headers.get("content-type") ?? "").includes("text/event-stream"),
    );
    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    if (reader !== undefined) {
      while (events.length < 2) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const matches = buffer.matchAll(/^event: (.+)$/gm);
        events.length = 0;
        for (const m of matches) events.push(m[1] as string);
      }
      await reader.cancel();
    }
  } catch {
    // abort is expected
  } finally {
    clearTimeout(streamTimer);
    controller.abort();
  }
  console.log(`  events received: ${events.join(", ")}`);
  check("stream emitted an open event", events.includes("open"));
  check("stream emitted a snapshot event", events.includes("snapshot"));

  /* ---------------------------------------------------------------------- */
  console.log("\n10. Recommendation actions — reason enforcement");
  // Milestone 6 generates recommendations. Insert one directly so the four
  // action routes and the reason rule can be verified now.
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  const deployment = await prisma.deployment.findFirst({
    where: { incidentId },
    include: { firefighter: true },
  });
  if (deployment === null) {
    console.log("  no deployment found");
    process.exitCode = 1;
    await prisma.$disconnect();
    return;
  }
  const makeRecommendation = async () =>
    prisma.recommendation.create({
      data: {
        incidentId,
        deploymentId: deployment.id,
        type: "rotate",
        priorityRank: 1,
        rationale: "Illustrative recommendation created by the verification harness.",
        suggestedAction: "Rotate this firefighter out at the next opportunity.",
        alternativesJson: JSON.stringify(["Increase monitoring frequency"]),
        confidence: "medium",
        expiresAtUtc: new Date(Date.now() + 5 * 60_000),
      },
    });

  const forReject = await makeRecommendation();

  for (const [label, body] of [
    ["missing reason", {}],
    ["empty reason", { reason: "" }],
    ["whitespace-only reason", { reason: "   \t\n  " }],
  ] as const) {
    const response = await req(
      "POST",
      `/api/recommendations/${forReject.id}/reject`,
      body,
    );
    console.log(
      `  reject with ${label}: status ${response.status} ${JSON.stringify(response.json["details"] ?? response.json["message"])}`,
    );
    check(`reject with ${label} returns 400`, response.status === 400);
  }

  for (const [label, body] of [
    ["missing reason", {}],
    ["whitespace-only reason", { reason: " " }],
  ] as const) {
    const response = await req(
      "POST",
      `/api/recommendations/${forReject.id}/override`,
      body,
    );
    console.log(`  override with ${label}: status ${response.status}`);
    check(`override with ${label} returns 400`, response.status === 400);
  }

  const ack = await req("POST", `/api/recommendations/${forReject.id}/acknowledge`, {
    actorLabel: "verification-harness",
  });
  check("acknowledge succeeds without a reason", ack.status === 200);

  const goodReject = await req("POST", `/api/recommendations/${forReject.id}/reject`, {
    actorLabel: "verification-harness",
    reason: "Crew is already rotating on my order",
  });
  console.log(`  reject with a real reason: status ${goodReject.status}`);
  console.log(`  ${JSON.stringify(goodReject.json["recommendation"])}`);
  check("reject with a reason returns 200", goodReject.status === 200);
  check(
    "recommendation is now rejected",
    ((goodReject.json["recommendation"] as Json)?.["status"]) === "rejected",
  );

  const forOverride = await makeRecommendation();
  const goodOverride = await req(
    "POST",
    `/api/recommendations/${forOverride.id}/override`,
    { actorLabel: "verification-harness", reason: "Holding position, exit compromised" },
  );
  check("override with a reason returns 200", goodOverride.status === 200);

  const forAccept = await makeRecommendation();
  const accepted = await req("POST", `/api/recommendations/${forAccept.id}/accept`, {
    actorLabel: "verification-harness",
  });
  check("accept succeeds without a reason", accepted.status === 200);

  /* ---------------------------------------------------------------------- */
  // Database-level guards, bypassing the API entirely.
  //
  // These use raw SQL on purpose. Prisma's typed client maps SQLite code 1811
  // (SQLITE_CONSTRAINT_TRIGGER) onto its generic "Foreign key constraint
  // violated" message, which would hide *why* the write was refused. Raw
  // queries surface SQLite's own message, so the assertion can name the guard
  // rather than just observing that something threw.
  console.log("\n  Database-level guards (raw SQL, bypassing the API):");

  const triggers = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
    "SELECT name FROM sqlite_master WHERE type='trigger' ORDER BY name",
  );
  console.log(`    triggers installed: ${triggers.map((t) => t.name).join(", ")}`);
  for (const expected of [
    "Observation_no_update",
    "Observation_no_delete",
    "AuditEvent_no_update",
    "AuditEvent_no_delete",
    "CommanderAction_reason_required_insert",
  ]) {
    check(`trigger ${expected} exists`, triggers.some((t) => t.name === expected));
  }

  async function expectBlocked(
    label: string,
    expectedMessage: string,
    run: () => Promise<unknown>,
  ): Promise<void> {
    try {
      await run();
      check(label, false, "the write succeeded");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(`    ${message.split("\n").pop()}`);
      check(label, message.includes(expectedMessage), `expected "${expectedMessage}"`);
    }
  }

  await expectBlocked(
    "database refuses a whitespace-only reject reason",
    "A reject or override requires a non-empty reason",
    () =>
      prisma.$executeRawUnsafe(
        `INSERT INTO "CommanderAction" ("id","incidentId","recommendationId","action","reasonText","actorLabel","createdAtUtc")
         VALUES (?, ?, NULL, 'reject', '   ', 'direct-db', ?)`,
        `probe-reject-${Date.now()}`,
        incidentId,
        Date.now(),
      ),
  );

  await expectBlocked(
    "database refuses an override with no reason",
    "A reject or override requires a non-empty reason",
    () =>
      prisma.$executeRawUnsafe(
        `INSERT INTO "CommanderAction" ("id","incidentId","recommendationId","action","reasonText","actorLabel","createdAtUtc")
         VALUES (?, ?, NULL, 'override', NULL, 'direct-db', ?)`,
        `probe-override-${Date.now()}`,
        incidentId,
        Date.now(),
      ),
  );

  const anyObservation = await prisma.observation.findFirst({ where: { incidentId } });
  if (anyObservation !== null) {
    await expectBlocked(
      "Observation refuses UPDATE",
      "Observation is append-only: UPDATE is not permitted",
      () =>
        prisma.$executeRawUnsafe(
          `UPDATE "Observation" SET "hrBpm" = 999 WHERE id = ?`,
          anyObservation.id,
        ),
    );
    await expectBlocked(
      "Observation refuses DELETE",
      "Observation is append-only: DELETE is not permitted",
      () =>
        prisma.$executeRawUnsafe(
          `DELETE FROM "Observation" WHERE id = ?`,
          anyObservation.id,
        ),
    );
  }

  const anyAudit = await prisma.auditEvent.findFirst({ where: { incidentId } });
  if (anyAudit !== null) {
    await expectBlocked(
      "AuditEvent refuses UPDATE",
      "AuditEvent is append-only: UPDATE is not permitted",
      () =>
        prisma.$executeRawUnsafe(
          `UPDATE "AuditEvent" SET "summary" = 'tampered' WHERE id = ?`,
          anyAudit.id,
        ),
    );
    await expectBlocked(
      "AuditEvent refuses DELETE",
      "AuditEvent is append-only: DELETE is not permitted",
      () =>
        prisma.$executeRawUnsafe(
          `DELETE FROM "AuditEvent" WHERE id = ?`,
          anyAudit.id,
        ),
    );
  }

  // An acknowledge needs no reason — the guard must not be a blanket ban.
  const probeAckId = `probe-ack-${Date.now()}`;
  try {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "CommanderAction" ("id","incidentId","recommendationId","action","reasonText","actorLabel","createdAtUtc")
       VALUES (?, ?, NULL, 'acknowledge', NULL, 'direct-db', ?)`,
      probeAckId,
      incidentId,
      Date.now(),
    );
    check("database allows an acknowledge with no reason", true);
  } catch (error) {
    check(
      "database allows an acknowledge with no reason",
      false,
      error instanceof Error ? error.message : String(error),
    );
  }

  await prisma.$disconnect();

  /* ---------------------------------------------------------------------- */
  console.log("\n11. GET /api/incidents/[id]/recommendations");
  const recs = await req("GET", `/api/incidents/${incidentId}/recommendations`);
  check("returns 200", recs.status === 200);
  for (const r of (recs.json["recommendations"] as Array<Json>) ?? []) {
    console.log(
      `    ${String(r["type"]).padEnd(10)} ${String(r["callsign"]).padEnd(10)} status ${String(r["status"]).padEnd(12)} actions ${((r["commanderActions"] as unknown[]) ?? []).length}`,
    );
  }

  /* ---------------------------------------------------------------------- */
  console.log("\n12. GET /api/audit");
  const audit = await req("GET", `/api/audit?incidentId=${incidentId}&limit=500`);
  check("returns 200", audit.status === 200);
  check("is declared append-only", audit.json["appendOnly"] === true);
  const auditEvents = (audit.json["events"] as Array<Json>) ?? [];
  const counts = new Map<string, number>();
  for (const e of auditEvents) {
    const type = String(e["eventType"]);
    counts.set(type, (counts.get(type) ?? 0) + 1);
  }
  console.log(`  ${auditEvents.length} events for this incident:`);
  for (const [type, count] of [...counts.entries()].sort()) {
    console.log(`    ${type.padEnd(34)} ${count}`);
  }
  for (const required of [
    "incident_created",
    "incident_started",
    "observation_ingested",
    "risk_assessed",
    "band_transition",
    "recommendation_acknowledged",
    "recommendation_rejected",
    "recommendation_overridden",
    "recommendation_accepted",
    "fire_front_provider_selected",
  ]) {
    check(`audit contains ${required}`, counts.has(required));
  }
  const rejection = auditEvents.find((e) => e["eventType"] === "recommendation_rejected");
  console.log(`  rejection event detail: ${JSON.stringify(rejection?.["detail"])}`);
  check(
    "rejection audit event stores the reason",
    typeof (rejection?.["detail"] as Json | undefined)?.["reason"] === "string",
  );

  const badAudit = await req("GET", "/api/audit?limit=9999");
  check("audit rejects an out-of-range limit with 400", badAudit.status === 400);

  /* ---------------------------------------------------------------------- */
  console.log("\n13. POST /api/incidents/[id]/stop");
  const stopped = await req("POST", `/api/incidents/${incidentId}/stop`, {
    actorLabel: "verification-harness",
    reason: "Verification complete",
  });
  check("returns 200", stopped.status === 200);
  check("status is stopped", ((stopped.json["incident"] as Json)?.["status"]) === "stopped");
  const restart = await req("POST", `/api/incidents/${incidentId}/start`, {});
  check("a stopped incident cannot be restarted (409)", restart.status === 409);

  console.log("\n14. Unknown ids return 404");
  const missing = await req("GET", "/api/incidents/00000000-0000-4000-8000-000000000000");
  check("unknown incident returns 404", missing.status === 404);
  const missingRec = await req(
    "POST",
    "/api/recommendations/00000000-0000-4000-8000-000000000000/acknowledge",
    {},
  );
  check("unknown recommendation returns 404", missingRec.status === 404);

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
