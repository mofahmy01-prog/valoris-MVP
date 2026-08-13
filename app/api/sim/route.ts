/**
 * Simulator control surface. Demo only.
 *
 * POST /api/sim  { action: "start" | "pause" | "reset" | "speed" | "inject" }
 *
 * A single route keeps the client simple and means one thing to remember on
 * stage. GET returns the current simulator state.
 */

import { NextResponse } from "next/server";
import { z } from "zod";

import {
  simInjectWindShift,
  simKillSensor,
  simPause,
  simReset,
  simRestoreSensors,
  simSpeed,
  simStart,
  simState,
} from "@/lib/sim/runtime";
import { CALLSIGNS, KILLABLE_CHANNELS } from "@/lib/sim/simulator";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  action: z.enum(["start", "pause", "reset", "speed", "inject"]),
  speed: z.number().optional(),
  inject: z.enum(["wind_shift", "kill_sensor", "restore_sensors"]).optional(),
  callsign: z.enum(CALLSIGNS as [string, ...string[]]).optional(),
  channel: z.enum(KILLABLE_CHANNELS as unknown as [string, ...string[]]).optional(),
});

function baseUrlFrom(request: Request): string {
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}

function summarise() {
  const s = simState();
  return {
    incidentId: s.incidentId,
    running: s.running,
    speed: s.speed,
    tick: s.tick,
    incidentMinutes: s.incidentMinutes,
    windShiftActive: s.windShiftActive,
    windDirDeg: s.windDirDeg,
    windSpeedMs: Math.round(s.windSpeedMs * 10) / 10,
    lastError: s.lastError,
    killed: Object.values(s.firefighters)
      .filter((f) => f.killedChannels.length > 0)
      .map((f) => ({ callsign: f.callsign, channels: f.killedChannels })),
    notice: "SIMULATION MODE — NOT FOR OPERATIONAL USE",
  };
}

export async function GET() {
  return NextResponse.json(summarise());
}

export async function POST(request: Request) {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "body must be JSON" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "bad request", details: parsed.error.issues },
      { status: 400 },
    );
  }

  const { action, speed, inject, callsign, channel } = parsed.data;

  switch (action) {
    case "start":
      await simStart(baseUrlFrom(request));
      break;
    case "pause":
      simPause();
      break;
    case "reset":
      await simReset(baseUrlFrom(request));
      break;
    case "speed":
      simSpeed(speed ?? 1);
      break;
    case "inject":
      if (inject === "wind_shift") simInjectWindShift();
      else if (inject === "kill_sensor" && callsign !== undefined && channel !== undefined) {
        simKillSensor(
          callsign as Parameters<typeof simKillSensor>[0],
          channel as Parameters<typeof simKillSensor>[1],
        );
      } else if (inject === "restore_sensors" && callsign !== undefined) {
        simRestoreSensors(callsign as Parameters<typeof simRestoreSensors>[0]);
      } else {
        return NextResponse.json(
          { error: "inject requires a known injection and its arguments" },
          { status: 400 },
        );
      }
      break;
  }

  return NextResponse.json(summarise());
}
