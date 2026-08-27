import { NextRequest, NextResponse } from "next/server";
import { requireMutationActor, resolveMenuActor } from "@/lib/auth";
import { listSavedSandwiches, saveSandwich, type SandwichAllergens } from "@/lib/sandwiches";

export async function GET(request: NextRequest) {
  try { await resolveMenuActor(request); return NextResponse.json({ sandwiches: await listSavedSandwiches() }, { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return NextResponse.json({ error: { message: (error as Error).message } }, { status: (error as { status?: number }).status || 503 }); }
}
export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { title?: string; allergens?: SandwichAllergens; mayContainNotes?: string; updatedBy?: string; parentMenuItemKey?: string };
    const actor = requireMutationActor(await resolveMenuActor(request));
    const sandwich = await saveSandwich(body.title || "", body.allergens || {}, actor.uid, body.mayContainNotes || "", body.parentMenuItemKey);
    return NextResponse.json({ sandwich, sandwiches: await listSavedSandwiches() });
  } catch (error) { return NextResponse.json({ error: { message: (error as Error).message } }, { status: (error as { status?: number }).status || 500 }); }
}
