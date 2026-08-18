import { NextResponse } from "next/server";
import { listSavedSandwiches, saveSandwich, type SandwichAllergens } from "@/lib/sandwiches";

export async function GET() { return NextResponse.json({ sandwiches: await listSavedSandwiches() }); }
export async function POST(request: Request) {
  try {
    const body = await request.json() as { title?: string; allergens?: SandwichAllergens; mayContainNotes?: string; updatedBy?: string; parentMenuItemKey?: string };
    const sandwich = await saveSandwich(body.title || "", body.allergens || {}, body.updatedBy || "Menu Planning", body.mayContainNotes || "", body.parentMenuItemKey);
    return NextResponse.json({ sandwich, sandwiches: await listSavedSandwiches() });
  } catch (error) { return NextResponse.json({ error: { message: (error as Error).message } }, { status: (error as { status?: number }).status || 500 }); }
}
