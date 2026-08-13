/**
 * Preflight check for the verification harnesses.
 *
 * WHY THIS EXISTS. Twice during Milestone 3 a dev server left running from an
 * earlier session kept port 3000, so a newly started server silently moved to
 * 3001 — and the harness then verified OLD code, with an old Prisma client,
 * against a NEW database. Both times it produced a failure that looked like a
 * real defect and was not.
 *
 * A spurious failure in a safety verification harness is worse than a slow one:
 * it trains you to distrust the harness, which is the one thing that has to stay
 * trustworthy. So every harness now proves it is talking to the code in this
 * working tree before it asserts anything.
 *
 * The check is exact: it loads the configs from disk through the same loaders the
 * app uses and compares the resulting hashes with what `/api/health` reports. A
 * stale server has a different hash the moment any parameter changes.
 */

import { DEFAULT_PHYSIOLOGY_CONFIG } from "../lib/physiology/default-config";
import { DEFAULT_RISK_CONFIG } from "../lib/risk/default-config";

export type PreflightResult = {
  ok: boolean;
  baseUrl: string;
  messages: string[];
};

export async function preflight(baseUrl: string): Promise<PreflightResult> {
  const expectedRisk = DEFAULT_RISK_CONFIG.configHash;
  const expectedPhysiology = DEFAULT_PHYSIOLOGY_CONFIG.configHash;
  const messages: string[] = [];

  let health: Record<string, unknown>;
  try {
    const response = await fetch(`${baseUrl}/api/health`);
    if (!response.ok) {
      return {
        ok: false,
        baseUrl,
        messages: [
          `/api/health returned ${response.status}. Start the server with \`npm run dev\`.`,
        ],
      };
    }
    health = (await response.json()) as Record<string, unknown>;
  } catch (error) {
    return {
      ok: false,
      baseUrl,
      messages: [
        `No server answering on ${baseUrl} (${error instanceof Error ? error.message : String(error)}).`,
        "Start it with `npm run dev`. If Next reported \"Port 3000 is in use\" and moved to another port, a stale server owns it.",
      ],
    };
  }

  const serverRisk = String(health["configHash"] ?? "");
  const serverPhysiology = String(health["physiologyConfigHash"] ?? "");

  if (serverRisk !== expectedRisk) {
    messages.push(
      `STALE SERVER: risk config hash mismatch. Working tree ${expectedRisk}, server ${serverRisk || "(not reported)"}.`,
    );
  }
  if (serverPhysiology !== expectedPhysiology) {
    messages.push(
      `STALE SERVER: physiology config hash mismatch. Working tree ${expectedPhysiology}, server ${serverPhysiology || "(not reported)"}.`,
    );
  }

  const guards = health["databaseGuards"] as Record<string, unknown> | undefined;
  if (guards === undefined) {
    messages.push(
      "Server did not report database guard status — it predates the guard check.",
    );
  } else if (guards["allInstalled"] !== true) {
    messages.push(
      `DATABASE GUARDS NOT INSTALLED: missing ${JSON.stringify(guards["missing"])}. Run \`npm run seed\` or \`npm run migrate\`.`,
    );
  }

  if (messages.length > 0) {
    messages.push(
      "Refusing to continue: a harness that verifies the wrong build reports failures that are not real.",
      "Kill stale servers, then restart one:",
      `  Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like '*valoris*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`,
    );
    return { ok: false, baseUrl, messages };
  }

  return {
    ok: true,
    baseUrl,
    messages: [
      `server on ${baseUrl} matches this working tree (risk ${serverRisk}, physiology ${serverPhysiology})`,
    ],
  };
}

/** Print the result, and exit non-zero rather than verifying a stale build. */
export function reportPreflight(result: PreflightResult): void {
  if (result.ok) {
    console.log(`  PREFLIGHT OK — ${result.messages[0]}`);
    return;
  }
  console.log("");
  console.log("!".repeat(78));
  console.log("PREFLIGHT FAILED — NOT VERIFYING AGAINST A STALE OR ABSENT SERVER");
  for (const m of result.messages) console.log(`  ${m}`);
  console.log("!".repeat(78));
  process.exit(1);
}
