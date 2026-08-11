import { readAuditEvents } from "@/lib/db/audit";
import { ok, parseSearchParams } from "@/lib/api/respond";
import { auditQuerySchema } from "@/lib/api/schemas";

export const dynamic = "force-dynamic";

/**
 * Read-only. There is no POST, PATCH, PUT or DELETE here, and none anywhere else
 * for AuditEvent — the table is append-only and the database enforces it.
 */
export async function GET(request: Request) {
  const parsed = parseSearchParams(request, auditQuerySchema);
  if (!parsed.ok) return parsed.response;

  const result = await readAuditEvents(parsed.data);
  return ok({ appendOnly: true, ...result });
}
