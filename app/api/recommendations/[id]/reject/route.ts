import { handleRecommendationAction } from "@/lib/api/recommendation-actions";

export const dynamic = "force-dynamic";

/** Reason required. Empty or whitespace-only is a 400, enforced server-side. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return handleRecommendationAction(request, id, "reject");
}
