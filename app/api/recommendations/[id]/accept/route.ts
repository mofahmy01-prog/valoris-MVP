import { handleRecommendationAction } from "@/lib/api/recommendation-actions";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return handleRecommendationAction(request, id, "accept");
}
