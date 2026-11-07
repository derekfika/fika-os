import { NextResponse } from "next/server";
import { z } from "zod";
import { monthlySpecialDraftSchema } from "@/lib/contracts";
import { beverageError, requireLocalBeverageActor } from "@/lib/runtime";
import { createSpecial, listMonthlySpecials } from "@/lib/store";

export const runtime = "nodejs";
const createRequestSchema = monthlySpecialDraftSchema.extend({ expectedVersion: z.number().int().nonnegative() });

export async function GET(request: Request) {
  try {
    const actor = requireLocalBeverageActor(request, "View");
    return NextResponse.json({ specials: await listMonthlySpecials(actor) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { const result = beverageError(error); return NextResponse.json(result.body, { status: result.status }); }
}
export async function POST(request: Request) {
  try {
    const actor = requireLocalBeverageActor(request, "Manage");
    const { expectedVersion, ...input } = createRequestSchema.parse(await request.json());
    const special = await createSpecial(input, actor, expectedVersion, request.headers.get("idempotency-key") || "");
    return NextResponse.json({ special }, { status: 201 });
  } catch (error) { const result = beverageError(error); return NextResponse.json(result.body, { status: result.status }); }
}
