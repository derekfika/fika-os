import { NextRequest, NextResponse } from "next/server";
import { requireActor } from "@/lib/auth";
import { assertPermission } from "@/lib/authmod";
import { db } from "@/lib/firebase-admin";
import { resolveDeliveredInAccess } from "@/lib/delivered-in-access";
import type { CanonicalRecord } from "@/lib/types";
import { listActiveCanonicalOplocs } from "@/lib/canonical-oplocs";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const actor = await requireActor(request);
    assertPermission(actor, "canonical.view");
    const service = request.nextUrl.searchParams.get("service") === "grab-and-go" ? "grab-and-go" : "delivered-in";
    const [oplocs, serviceRecords] = await Promise.all([
      listActiveCanonicalOplocs(),
      db.collection("integrationHubCanonical").where("entityType", "in", ["Service Definition", "Service Arrangement"]).get(),
    ]);
    return NextResponse.json(resolveDeliveredInAccess(actor, [...oplocs, ...serviceRecords.docs.map(document => document.data())] as CanonicalRecord[], service), { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) {
    return NextResponse.json({ error: { message: error instanceof Error ? error.message : "Delivered-In access could not be resolved." } }, { status: Number((error as { status?: number }).status) || 403 });
  }
}
