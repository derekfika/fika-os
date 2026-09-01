import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/api";
import { FirestoreAuthModRepository } from "@/lib/authmod-core";
import { resolvePermittedOplocIds } from "@/lib/oploc-authorization";
import { getOplocReadPackage, validateOplocReadPackage } from "@/lib/oploc-read-package";
import { requireFikaSession } from "@/lib/fika-session";

export async function GET(request: NextRequest) {
  try {
    const session = await requireFikaSession(request);
    const repository = new FirestoreAuthModRepository();
    const principal = { type: "interactive" as const, id: session.authmodIdentityId, displayName: session.displayName, email: session.email, identityKind: session.identityKind };
    const scope = await resolvePermittedOplocIds({ repository, principal, appId: "hospitality-booking" });
    const packageValue = validateOplocReadPackage((await getOplocReadPackage()).value);
    const sites = packageValue.oplocs.filter(oploc => scope.all || scope.ids.has(oploc.canonicalId)).map(oploc => ({ id: oploc.canonicalId, label: oploc.label, active: true }));
    return NextResponse.json({ sites }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}
