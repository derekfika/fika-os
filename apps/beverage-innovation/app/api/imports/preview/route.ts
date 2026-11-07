import { NextResponse } from "next/server";
import { classificationSchema } from "@/lib/contracts";
import { previewPastedRecipe } from "@/lib/import-preview";
import { beverageError, requireLocalBeverageActor } from "@/lib/runtime";
import { findBeveragesByName } from "@/lib/repository";

export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    requireLocalBeverageActor(request, "Contribute"); const body = await request.json();
    const text = String(body.text || ""); const classification = classificationSchema.parse(body.classification || "classic_source");
    const initial = previewPastedRecipe({ text, classification });
    const duplicate = initial.candidate.name ? (await findBeveragesByName(initial.candidate.name, 1)).length > 0 : false;
    const result = duplicate ? previewPastedRecipe({ text, classification, existingNames: [initial.candidate.name] }) : initial;
    return NextResponse.json(result);
  } catch (error) { const result = beverageError(error); return NextResponse.json(result.body, { status: result.status }); }
}
