import { NextResponse } from "next/server";
import { previewRecipeDocument } from "@/lib/import-document";
import { readDocumentPreviewRequest } from "@/lib/import-document-request";
import { addLocalImportDuplicateWarnings } from "@/lib/import-duplicate-warnings";
import { beverageError, requireLocalBeverageActor } from "@/lib/runtime";

export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    requireLocalBeverageActor(request, "Contribute");
    const result = await previewRecipeDocument(await readDocumentPreviewRequest(request));
    await addLocalImportDuplicateWarnings(result);
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const result = beverageError(error);
    return NextResponse.json(result.body, { status: result.status });
  }
}
