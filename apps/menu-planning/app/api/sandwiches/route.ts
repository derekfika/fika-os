import { NextResponse } from "next/server";
import { listSavedSandwiches, saveSandwich, type SandwichAllergens } from "@/lib/sandwiches";
import { requireOrganisationMutationActor, resolveMenuActor } from "@/lib/auth";

export async function GET() { return NextResponse.json({ sandwiches: await listSavedSandwiches() }); }
export async function POST(request: Request) {
  try {
    const actor = requireOrganisationMutationActor(await resolveMenuActor(request));
    const body = await request.json() as { title?: string; allergens?: SandwichAllergens; mayContainNotes?: string; parentMenuItemKey?: string };
    const sandwich = await saveSandwich(body.title || "", body.allergens || {}, actor.uid, body.mayContainNotes || "", body.parentMenuItemKey);
    return NextResponse.json({ sandwich, sandwiches: await listSavedSandwiches() });
  } catch (error) { return NextResponse.json({ error: { message: (error as Error).message } }, { status: (error as { status?: number }).status || 500 }); }
}
