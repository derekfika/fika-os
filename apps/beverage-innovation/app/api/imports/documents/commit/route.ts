import { NextResponse } from "next/server";
import { requireDocumentRecipeCandidate } from "@/lib/import-document";
import { readDocumentCommitRequest } from "@/lib/import-document-request";
import { beverageError, requireLocalBeverageActor } from "@/lib/runtime";
import { createImportedBeverage } from "@/lib/store";

export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const actor = requireLocalBeverageActor(request, "Contribute");
    const { upload, review } = await readDocumentCommitRequest(request);
    const source = await requireDocumentRecipeCandidate(upload, review);
    const record = await createImportedBeverage(review.reviewedCandidate, review.classification, source, actor, request.headers.get("idempotency-key") || "");
    return NextResponse.json({ record, sourceHash: source.sourceHash }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const result = beverageError(error);
    return NextResponse.json(result.body, { status: result.status });
  }
}
