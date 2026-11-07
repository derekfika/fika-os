import { NextResponse } from "next/server";
import { localImportPreviewRequestSchema } from "@/lib/contracts";
import { normaliseImportName, previewPastedRecipes } from "@/lib/import-preview";
import { beverageError, requireLocalBeverageActor } from "@/lib/runtime";
import { findBeveragesByName } from "@/lib/repository";

export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    requireLocalBeverageActor(request, "Contribute");
    const { text } = localImportPreviewRequestSchema.parse(await request.json());
    const result = previewPastedRecipes(text);
    const names = new Set(result.candidates.map(candidate => normaliseImportName(candidate.recipe.name)).filter(Boolean));
    const duplicates = new Set(await Promise.all([...names].map(async name =>
      (await findBeveragesByName(name, 1)).length ? name : undefined,
    )));
    for (const candidate of result.candidates) {
      if (duplicates.has(normaliseImportName(candidate.recipe.name))) {
        candidate.warnings.push("Possible duplicate name in the local Beverage records. Check before saving.");
      }
    }
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { const result = beverageError(error); return NextResponse.json(result.body, { status: result.status }); }
}
