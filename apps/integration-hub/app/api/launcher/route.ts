import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/api";
import { requireFikaSession } from "@/lib/fika-session";
import { FirestoreAuthModRepository } from "@/lib/authmod-core";
import { buildLauncher } from "@/lib/launcher";
import { withDataTrace } from "@fika/server-shared/data-source-meter-server";

async function handleGet(request: NextRequest) {
  try {
    const session = await requireFikaSession(request);
    const repository = new FirestoreAuthModRepository();
    const principal = { type: "interactive" as const, id: session.authmodIdentityId, displayName: session.displayName, email: session.email, identityKind: session.identityKind, representedOplocId: session.representedOplocId, primaryCustodianLegendId: session.primaryCustodianLegendId };
    return NextResponse.json(await buildLauncher(repository, principal), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function GET(request: NextRequest) {
  return withDataTrace({ app: "integration-hub", action: "launcher.load", path: request.nextUrl.pathname, requestId: request.headers.get("x-request-id") || undefined }, () => handleGet(request));
}
