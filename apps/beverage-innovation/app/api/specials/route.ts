import { NextResponse } from "next/server";
import { monthlySpecialSchema } from "@/lib/contracts";
import { beverageError, requireLocalBeverageActor } from "@/lib/runtime";
import { createSpecial, listMonthlySpecials } from "@/lib/store";

export const runtime = "nodejs";
export async function GET(request: Request) { try { requireLocalBeverageActor(request, "View"); return NextResponse.json({ specials: await listMonthlySpecials() }); } catch (error) { const result = beverageError(error); return NextResponse.json(result.body, { status: result.status }); } }
export async function POST(request: Request) {
  try {
    const actor = requireLocalBeverageActor(request, "Manage"); const raw = await request.json();
    const input = monthlySpecialSchema.pick({ title: true, beverageId: true, beverageVersionId: true, month: true, startDate: true, endDate: true, targetSites: true, notes: true }).parse(raw);
    const special = await createSpecial(input, actor, raw.expectedVersion, request.headers.get("idempotency-key") || "");
    return NextResponse.json({ special }, { status: 201 });
  } catch (error) { const result = beverageError(error); return NextResponse.json(result.body, { status: result.status }); }
}
