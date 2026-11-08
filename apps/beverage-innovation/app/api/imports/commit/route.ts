import { NextResponse } from "next/server";
import { localImportCommitRequestSchema } from "@/lib/contracts";
import { requirePastedRecipeCandidate } from "@/lib/import-preview";
import { beverageError, requireLocalBeverageActor } from "@/lib/runtime";
import { createImportedBeverage } from "@/lib/store";

export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const actor = requireLocalBeverageActor(request, "Contribute");
    const input = localImportCommitRequestSchema.parse(await request.json());
    const source = requirePastedRecipeCandidate(input);
    const record = await createImportedBeverage(input.reviewedCandidate, input.classification, source, actor, request.headers.get("idempotency-key") || "");
    return NextResponse.json({ record, sourceHash: source.sourceHash }, { status: 201 });
  } catch (error) { const result = beverageError(error); return NextResponse.json(result.body, { status: result.status }); }
}
