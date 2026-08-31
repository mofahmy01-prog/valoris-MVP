import { NextResponse } from "next/server";
import { z } from "zod";

/**
 * Banner every API response carries, so no consumer can miss it.
 *
 * The access-control half is not a formality. This build has NO authentication:
 * no middleware, no sessions, no route protection, and no organisation scoping
 * on any query. Anyone who can reach the process can read every firefighter's
 * medical conditions and write outcomes under any name they choose, because
 * `recordedBy` is a self-declared string that nothing verifies.
 *
 * It is stated on every response rather than only in a document, because the
 * consumer most likely to forget is a future integration that never read one.
 */
export const SIMULATION_NOTICE =
  "SIMULATION MODE — NOT FOR OPERATIONAL USE. UNAUTHENTICATED: this build has no access control, no tenancy isolation, and no verified identity behind any actor label.";

export type ApiErrorBody = {
  error: string;
  message: string;
  details?: unknown;
  notice: string;
};

export function ok<T>(data: T, status = 200): NextResponse {
  return NextResponse.json({ ...data, notice: SIMULATION_NOTICE }, { status });
}

export function badRequest(message: string, details?: unknown): NextResponse {
  const body: ApiErrorBody = {
    error: "bad_request",
    message,
    notice: SIMULATION_NOTICE,
  };
  if (details !== undefined) body.details = details;
  return NextResponse.json(body, { status: 400 });
}

export function notFound(message: string): NextResponse {
  return NextResponse.json(
    { error: "not_found", message, notice: SIMULATION_NOTICE } satisfies ApiErrorBody,
    { status: 404 },
  );
}

export function conflict(message: string): NextResponse {
  return NextResponse.json(
    { error: "conflict", message, notice: SIMULATION_NOTICE } satisfies ApiErrorBody,
    { status: 409 },
  );
}

export function serverError(message: string): NextResponse {
  return NextResponse.json(
    { error: "server_error", message, notice: SIMULATION_NOTICE } satisfies ApiErrorBody,
    { status: 500 },
  );
}

/**
 * Parse a JSON body against a schema. Any failure — malformed JSON, wrong
 * shape, empty required reason — is a 400 with the field-level detail.
 */
export async function parseJsonBody<S extends z.ZodTypeAny>(
  request: Request,
  schema: S,
): Promise<{ ok: true; data: z.infer<S> } | { ok: false; response: NextResponse }> {
  let raw: unknown;
  try {
    const text = await request.text();
    raw = text.trim() === "" ? {} : JSON.parse(text);
  } catch {
    return {
      ok: false,
      response: badRequest("Request body must be valid JSON"),
    };
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      response: badRequest(
        "Request body failed validation",
        parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      ),
    };
  }
  return { ok: true, data: parsed.data };
}

export function parseSearchParams<S extends z.ZodTypeAny>(
  request: Request,
  schema: S,
): { ok: true; data: z.infer<S> } | { ok: false; response: NextResponse } {
  const url = new URL(request.url);
  const raw: Record<string, string> = {};
  url.searchParams.forEach((value, key) => {
    raw[key] = value;
  });
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      response: badRequest(
        "Query parameters failed validation",
        parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      ),
    };
  }
  return { ok: true, data: parsed.data };
}
