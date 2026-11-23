import type { NextRequest } from "next/server";
import { catalogueGateway } from "../../../lib/catalogue-gateway";
import { studioRuntime } from "../../../lib/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handle(request: NextRequest, method: "GET" | "POST") {
  try {
    const config = studioRuntime();
    return catalogueGateway(config)[method](request, request.cookies.get(config.name)?.value);
  } catch {
    return Response.json({ error: { code: "CATALOGUE_UNAVAILABLE", message: "The catalogue is unavailable in this environment." } },
      { status: 503, headers: { "Cache-Control": "private, no-store" } });
  }
}

export const GET = (request: NextRequest) => handle(request, "GET");
export const POST = (request: NextRequest) => handle(request, "POST");
