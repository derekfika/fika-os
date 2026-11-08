import { NextResponse } from "next/server";
import { editableMonthlySpecialPatchSchema, monthlySpecialSchema } from "@/lib/contracts";
import { beverageError, requireLocalBeverageActor } from "@/lib/runtime";
import { editSpecial, setSpecialStatus } from "@/lib/store";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
export async function PATCH(request: Request, context: Context) {
  try {
    const actor = requireLocalBeverageActor(request, "Manage"); const id = monthlySpecialSchema.shape.id.parse((await context.params).id); const raw = await request.json();
    const expectedVersion = typeof raw.expectedVersion === "number" ? raw.expectedVersion : -1; const key = request.headers.get("idempotency-key") || "";
    if (raw.status) return NextResponse.json({ special: await setSpecialStatus(id, monthlySpecialSchema.shape.status.parse(raw.status), actor, expectedVersion, key) });
    const patch = editableMonthlySpecialPatchSchema.parse(raw.patch || {});
    return NextResponse.json({ special: await editSpecial(id, patch, actor, expectedVersion, key) });
  } catch (error) { const result = beverageError(error); return NextResponse.json(result.body, { status: result.status }); }
}
