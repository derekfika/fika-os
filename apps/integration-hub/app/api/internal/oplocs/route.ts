import { NextRequest, NextResponse } from "next/server";
import { withDataTrace } from "@fika/server-shared/data-source-meter-server";
import { internalTokenAllowed } from "../../../../../shared/internal-auth";
import { getOplocReadPackage, validateOplocReadPackage } from "@/lib/oploc-read-package";

export const dynamic = "force-dynamic";

async function handleGet(request: NextRequest) {
  if (!internalTokenAllowed(request)) return NextResponse.json({ error: { message: "Internal access required." } }, { status: 403 });
  try {
    const { value } = await getOplocReadPackage();
    return NextResponse.json(validateOplocReadPackage(value), { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) {
    return NextResponse.json({ error: { message: error instanceof Error ? error.message : "OPLOC authority is unavailable." } }, { status: 502 });
  }
}

export const GET = (request: NextRequest) => withDataTrace({ app: "integration-hub", action: "integration-hub.internal-oploc.load", path: request.nextUrl.pathname }, () => handleGet(request));
