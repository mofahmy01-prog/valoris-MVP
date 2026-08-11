/**
 * Server-Sent Events stream of the incident picture.
 *
 * Emits a `snapshot` event immediately on connect, then on a fixed interval,
 * plus a `heartbeat` so a client can tell "nothing changed" from "connection
 * died". A stalled stream must never be mistaken for a calm incident, so every
 * frame carries `generatedAtUtc` and the client is expected to show its age.
 */

import { prisma } from "@/lib/db/client";
import { notFound } from "@/lib/api/respond";
import { buildIncidentSnapshot } from "@/lib/incident/snapshot";

export const dynamic = "force-dynamic";

const SNAPSHOT_INTERVAL_MS = 2_000;
const HEARTBEAT_INTERVAL_MS = 10_000;

function frame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const incident = await prisma.incident.findUnique({
    where: { id },
    select: { id: true },
  });
  if (incident === null) return notFound(`No incident with id ${id}`);

  const encoder = new TextEncoder();
  let snapshotTimer: ReturnType<typeof setInterval> | undefined;
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown): void => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(frame(event, data)));
        } catch {
          closed = true;
        }
      };

      const cleanup = (): void => {
        if (closed) return;
        closed = true;
        if (snapshotTimer !== undefined) clearInterval(snapshotTimer);
        if (heartbeatTimer !== undefined) clearInterval(heartbeatTimer);
        try {
          controller.close();
        } catch {
          // already closed
        }
      };

      request.signal.addEventListener("abort", cleanup);

      send("open", {
        incidentId: id,
        notice: "SIMULATION MODE — NOT FOR OPERATIONAL USE",
        snapshotIntervalMs: SNAPSHOT_INTERVAL_MS,
      });

      const pushSnapshot = async (): Promise<void> => {
        if (closed) return;
        try {
          const snapshot = await buildIncidentSnapshot(id);
          if (snapshot === null) {
            send("error", { message: `Incident ${id} no longer exists` });
            cleanup();
            return;
          }
          send("snapshot", snapshot);
        } catch (error) {
          send("error", {
            message: error instanceof Error ? error.message : String(error),
          });
        }
      };

      await pushSnapshot();

      snapshotTimer = setInterval(() => {
        void pushSnapshot();
      }, SNAPSHOT_INTERVAL_MS);

      heartbeatTimer = setInterval(() => {
        send("heartbeat", { atUtc: new Date().toISOString() });
      }, HEARTBEAT_INTERVAL_MS);
    },

    cancel() {
      closed = true;
      if (snapshotTimer !== undefined) clearInterval(snapshotTimer);
      if (heartbeatTimer !== undefined) clearInterval(heartbeatTimer);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
