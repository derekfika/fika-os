import type { NextRequest } from "next/server";
import { assertStudioRequestHost, authoriseStudioRequest } from "../../../../lib/auth";
import { studioRouteTrace } from "../../../../lib/data-trace";
import { StudioProblem } from "../../../../lib/problem";
import { studioRuntime } from "../../../../lib/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };

export const GET = studioRouteTrace("/api/studio/access", async (request: NextRequest) => {
  try {
    const config = studioRuntime();
    assertStudioRequestHost(config, request.headers.get("host"));
    await authoriseStudioRequest(request, request.cookies.get(config.name)?.value, config);
    return new Response(null, { status: 204, headers });
  } catch (error) {
    const problem = error instanceof StudioProblem ? error : new StudioProblem(503, "AUTHORITY_UNAVAILABLE", "The Hub could not verify Studio access.");
    return Response.json({ code: problem.code, error: problem.message }, { status: problem.status, headers });
  }
});
