import { notFound, ok } from "@/lib/api/respond";
import { buildIncidentSnapshot } from "@/lib/incident/snapshot";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const snapshot = await buildIncidentSnapshot(id);
  if (snapshot === null) return notFound(`No incident with id ${id}`);
  return ok(snapshot);
}
