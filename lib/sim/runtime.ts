/**
 * Simulator runtime — the tick loop and the poster.
 *
 * Holds one simulator per server process on the global object, so Next's dev
 * module reloading does not spawn a second loop.
 *
 * Every tick POSTs through the real `/api/incidents/[id]/observations` route.
 * That route runs Zod validation, the PurpleAir correction, the physiology
 * pipeline, the risk engine, provenance and the audit log — exactly as a real
 * sensor feed would.
 */

import {
  advance,
  atmosphereFor,
  CALLSIGNS,
  initialSimState,
  toLatLng,
  type Callsign,
  type KillableChannel,
  type SimState,
} from "./simulator";

import { DEFAULT_DIABETES_CONFIG } from "@/lib/sensors/cgm/default-config";
import { assessGlucose } from "@/lib/sensors/cgm/lag-correction";

const TICK_INTERVAL_MS = 2000;

/**
 * Runs the modelled glucose through the real CGM pipeline: a simulated-vendor
 * reading, interstitial lag correction, latency accounting. What comes back is
 * what the engine consumes.
 */
function correctedGlucoseFor(glucoseMmolL: number): number {
  const nowMs = Date.now();
  const assessment = assessGlucose(
    {
      valueMmolL: glucoseMmolL,
      // Falling under load, which is when the lag correction matters.
      trend: "singleDown",
      trendRateMmolLPerMin: -0.05,
      recordedAtMs: nowMs - 60_000,
      receivedAtMs: nowMs,
      latencySec: 60,
      vendor: "simulated",
      dataTier: "C_SYNTHETIC_MODEL_DRIVEN",
      isSandbox: false,
    },
    nowMs,
    DEFAULT_DIABETES_CONFIG,
  );
  return assessment.usableMmolL ?? assessment.correctedMmolL;
}

type Runtime = {
  state: SimState;
  timer: ReturnType<typeof setInterval> | null;
  baseUrl: string;
};

const globalForSim = globalThis as unknown as { valorisSim?: Runtime };

function runtime(): Runtime {
  if (globalForSim.valorisSim === undefined) {
    globalForSim.valorisSim = {
      state: initialSimState(),
      timer: null,
      baseUrl: "http://localhost:3000",
    };
  }
  return globalForSim.valorisSim;
}

export function simState(): SimState {
  return runtime().state;
}

/** Sensor timestamp: frozen for a killed channel, current otherwise. */
function channel(
  value: number,
  killed: boolean,
  nowIso: string,
  frozenIso: string,
): { value: number; updatedAtUtc: string } {
  return { value: Math.round(value * 10) / 10, updatedAtUtc: killed ? frozenIso : nowIso };
}

async function postTick(rt: Runtime): Promise<void> {
  const { state } = rt;
  if (state.incidentId === null) return;

  const now = new Date();
  const nowIso = now.toISOString();
  // A killed channel keeps reporting the same instant, so it ages out on its
  // own through the existing staleness rules.
  const frozenIso = new Date(now.getTime() - 15 * 60_000).toISOString();

  const observations = CALLSIGNS.map((callsign) => {
    const f = state.firefighters[callsign];
    const air = atmosphereFor(state, f);
    const { lat, lng } = toLatLng(f.eastM, f.northM);
    const killed = (c: KillableChannel): boolean => f.killedChannels.includes(c);

    return {
      callsign,
      recordedAtUtc: nowIso,
      source: "simulated_wearable" as const,
      vitals: {
        hrBpm: channel(f.hrBpm, killed("hrBpm"), nowIso, frozenIso),
        spo2Pct: channel(f.spo2Pct, killed("spo2Pct"), nowIso, frozenIso),
        respRatePerMin: channel(f.respRatePerMin, false, nowIso, frozenIso),
        hydrationPct: channel(f.hydrationPct, false, nowIso, frozenIso),
        fallDetected: false,
        // BRAVO-1 is the only firefighter wearing a CGM. The value goes through
        // the interstitial lag correction before it is reported, so what the
        // engine sees is lag-corrected blood glucose, not the raw sensor value.
        ...(callsign === "BRAVO-1"
          ? {
              glucoseMmolL: channel(
                correctedGlucoseFor(f.glucoseMmolL),
                false,
                nowIso,
                frozenIso,
              ),
            }
          : {}),
      },
      environment: {
        ambientTempC: channel(air.ambientTempC, false, nowIso, frozenIso),
        humidityPct: channel(air.humidityPct, false, nowIso, frozenIso),
        coPpm: channel(air.coPpm, killed("coPpm"), nowIso, frozenIso),
        windSpeedMs: channel(state.windSpeedMs, false, nowIso, frozenIso),
        windDirDeg: channel(state.windDirDeg, false, nowIso, frozenIso),
        // PM2.5 arrives as a raw two-channel PurpleAir reading and is corrected
        // by the existing ingestion path, not by the simulator.
        purpleAir: {
          pm25_cf_1_a: Math.round(air.pm25UgM3 * 1.98),
          pm25_cf_1_b: Math.round(air.pm25UgM3 * 2.02),
          humidityPct: air.humidityPct,
          temperatureC: air.ambientTempC,
          sensorId: "pa-sim-01",
          updatedAtUtc: killed("pm25UgM3") ? frozenIso : nowIso,
          isRealSensorData: false,
        },
      },
      position: {
        lat,
        lng,
        distanceToSafeZoneM: Math.round(Math.hypot(f.eastM + 900, f.northM - 700)),
        escapeRouteStatus: "clear" as const,
        scbaPressurePct: Math.round(f.scbaPressurePct * 10) / 10,
        scbaOnAir: true,
        wearingPpe: true,
        timeOnTaskMin: f.timeOnTaskMin,
        fixUpdatedAtUtc: nowIso,
        escapeRouteUpdatedAtUtc: nowIso,
        distanceToSafeZoneUpdatedAtUtc: nowIso,
        scbaPressureUpdatedAtUtc: killed("scbaPressurePct") ? frozenIso : nowIso,
      },
    };
  });

  const response = await fetch(
    `${rt.baseUrl}/api/incidents/${state.incidentId}/observations`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actorLabel: "simulator", observations }),
    },
  );

  if (!response.ok) {
    rt.state.lastError = `observation POST returned ${response.status}: ${(await response.text()).slice(0, 200)}`;
  } else {
    rt.state.lastError = null;
  }
}

function stopTimer(rt: Runtime): void {
  if (rt.timer !== null) {
    clearInterval(rt.timer);
    rt.timer = null;
  }
}

function startTimer(rt: Runtime): void {
  stopTimer(rt);
  rt.timer = setInterval(() => {
    if (!rt.state.running) return;
    // Speed multiplies incident minutes per wall-clock tick.
    for (let i = 0; i < rt.state.speed; i += 1) {
      rt.state = advance(rt.state);
    }
    void postTick(rt).catch((error: unknown) => {
      rt.state.lastError = error instanceof Error ? error.message : String(error);
    });
  }, TICK_INTERVAL_MS);
}

export async function simStart(baseUrl: string): Promise<SimState> {
  const rt = runtime();
  rt.baseUrl = baseUrl;

  if (rt.state.incidentId === null) {
    const created = await fetch(`${baseUrl}/api/incidents`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Palisades Fire 2025 — simulated deployment",
        scenarioKey: "palisades_replay",
        centroidLat: 34.0725,
        centroidLng: -118.5425,
      }),
    });
    if (!created.ok) {
      rt.state.lastError = `could not create incident: ${created.status}`;
      return rt.state;
    }
    const body = (await created.json()) as { incident?: { id?: string } };
    rt.state.incidentId = body.incident?.id ?? null;
    if (rt.state.incidentId !== null) {
      await fetch(`${baseUrl}/api/incidents/${rt.state.incidentId}/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actorLabel: "simulator" }),
      });
    }
  }

  rt.state.running = true;
  startTimer(rt);
  // Post one tick immediately so the first poll has something to show.
  rt.state = advance(rt.state);
  await postTick(rt);
  return rt.state;
}

export function simPause(): SimState {
  const rt = runtime();
  rt.state.running = false;
  return rt.state;
}

export async function simReset(baseUrl: string): Promise<SimState> {
  const rt = runtime();
  stopTimer(rt);
  const previous = rt.state.incidentId;
  rt.state = initialSimState();
  rt.baseUrl = baseUrl;
  if (previous !== null) {
    await fetch(`${baseUrl}/api/incidents/${previous}/stop`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actorLabel: "simulator" }),
    }).catch(() => undefined);
  }
  return rt.state;
}

export function simSpeed(speed: number): SimState {
  const rt = runtime();
  rt.state.speed = speed === 5 || speed === 20 ? speed : 1;
  return rt.state;
}

export function simInjectWindShift(): SimState {
  const rt = runtime();
  rt.state.windShiftActive = true;
  // Wind swings round to drive the front at the ALPHA crew.
  rt.state.windDirDeg = 70;
  rt.state.windSpeedMs = Math.max(rt.state.windSpeedMs, 11);
  return rt.state;
}

export function simKillSensor(
  callsign: Callsign,
  channelName: KillableChannel,
): SimState {
  const rt = runtime();
  const f = rt.state.firefighters[callsign];
  if (!f.killedChannels.includes(channelName)) {
    f.killedChannels = [...f.killedChannels, channelName];
  }
  return rt.state;
}

export function simRestoreSensors(callsign: Callsign): SimState {
  const rt = runtime();
  rt.state.firefighters[callsign].killedChannels = [];
  return rt.state;
}
