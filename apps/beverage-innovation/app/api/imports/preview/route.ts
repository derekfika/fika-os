import { NextResponse } from "next/server";
import { localImportPreviewRequestSchema } from "@/lib/contracts";
import { previewPastedRecipes } from "@/lib/import-preview";
import { addLocalImportDuplicateWarnings } from "@/lib/import-duplicate-warnings";
import { beverageError, requireLocalBeverageActor } from "@/lib/runtime";

export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    requireLocalBeverageActor(request, "Contribute");
    const { text } = localImportPreviewRequestSchema.parse(await request.json());
    const result = previewPastedRecipes(text);
    await addLocalImportDuplicateWarnings(result);
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { const result = beverageError(error); return NextResponse.json(result.body, { status: result.status }); }
}
