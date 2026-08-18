import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse } from "@/lib/api";
import { requireActor } from "@/lib/auth";
import { assertPermission } from "@/lib/authmod";
import { db } from "@/lib/firebase-admin";

const Query = z.object({ limit: z.coerce.number().int().min(1).max(200).default(100) }).strict();

export async function GET(req: NextRequest) {
  try {
    const actor = await requireActor(req); assertPermission(actor, "canonical.view");
    const query = Query.parse(Object.fromEntries(req.nextUrl.searchParams));
    const snapshot = await db.collection("integrationHubGovernanceAudit").orderBy("timestamp", "desc").limit(query.limit).get();
    const events = snapshot.docs.map(document => { const event = { id: document.id, ...document.data() }; if (actor.role === "integration-admin") return event; const safe = { ...event } as Record<string, unknown>; delete safe.exactDiff; delete safe.reason; return safe; });
    return NextResponse.json({ events, exactDiffVisible: actor.role === "integration-admin" });
  } catch (error) { return errorResponse(error); }
}
