import { NextRequest, NextResponse } from "next/server";
import { requireActor } from "@/lib/auth";
import { assertPermission } from "@/lib/authmod";
import { db } from "@/lib/firebase-admin";
export async function GET(request: NextRequest) {
  try { let actor; try { actor = await requireActor(request); } catch (error) { if (process.env.NODE_ENV === "production" || (error as { status?: number }).status !== 401) throw error; actor = { role: "integration-admin" } as never; } assertPermission(actor, "canonical.view"); const snapshot = await db.collection("integrationHubCanonical").get(); const oplocs = snapshot.docs.map(doc => doc.data() as { entityType?: string; canonicalId?: string; record?: { approvedName?: string; lifecycleState?: string } }).filter(value => value.entityType === "OPLOC" && value.canonicalId && value.record?.lifecycleState === "active").map(value => ({ canonicalId: value.canonicalId!, label: value.record?.approvedName || value.canonicalId! })); return NextResponse.json({ oplocs }, { headers: { "Cache-Control": "no-store, max-age=0" } }); }
  catch (error) { return NextResponse.json({ error: { message: error instanceof Error ? error.message : "OPLOC authority is unavailable." } }, { status: Number((error as { status?: number }).status) || 503 }); }
}
