import { NextResponse } from "next/server";
import { approvalDecisionSchema, approvalKindSchema, classificationSchema, lifecycleSchema } from "@/lib/contracts";
import { beverageError, requireLocalBeverageActor } from "@/lib/runtime";
import { createBeverage, createVersion, listBeverages, recordApproval, setLifecycle, updateBeverage, updateVersion } from "@/lib/store";

export const runtime = "nodejs";
const keyFor = (request: Request) => request.headers.get("idempotency-key") || "";
const expected = (body: Record<string, unknown>) => typeof body.expectedVersion === "number" ? body.expectedVersion : -1;

export async function GET(request: Request) {
  try { requireLocalBeverageActor(request, "View"); return NextResponse.json({ records: await listBeverages() }); }
  catch (error) { const result = beverageError(error); return NextResponse.json(result.body, { status: result.status }); }
}

export async function POST(request: Request) {
  try {
    const actor = requireLocalBeverageActor(request, "Contribute"); const body = await request.json();
    const created = await createBeverage({ name: body.name, description: body.description, beverageType: body.beverageType || "Signature drink", classification: classificationSchema.parse(body.classification || "draft_concept") }, actor, expected(body), keyFor(request));
    return NextResponse.json({ record: created }, { status: 201 });
  } catch (error) { const result = beverageError(error); return NextResponse.json(result.body, { status: result.status }); }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json(); const id = typeof body.id === "string" ? body.id : "";
    if (!id) throw Object.assign(new Error("Beverage ID is required."), { status: 400, code: "BEVERAGE_ID_REQUIRED" });
    const action = body.action === "approval" ? "Approve" : body.action === "version" || body.action === "updateVersion" || body.action === "update" ? "Contribute" : "Manage";
    const actor = requireLocalBeverageActor(request, action); const version = expected(body); const key = keyFor(request);
    if (body.action === "approval") {
      const record = await recordApproval(id, approvalKindSchema.parse(body.kind), approvalDecisionSchema.parse(body.decision), actor, version, key, body.notes);
      return NextResponse.json({ record });
    }
    if (body.action === "version") return NextResponse.json({ record: await createVersion(id, actor, version, key) });
    if (body.action === "updateVersion") {
      if (!body.versionId || !Array.isArray(body.ingredients) || !Array.isArray(body.equipment)) throw Object.assign(new Error("Recipe ingredients and equipment are required."), { status: 400, code: "BEVERAGE_RECIPE_REQUIRED" });
      return NextResponse.json({ record: await updateVersion(id, body.versionId, { recipeNotes: body.recipeNotes || "", method: body.method || "", ingredients: body.ingredients, equipment: body.equipment, sellingPriceExVat: body.sellingPriceExVat }, actor, version, key) });
    }
    if (body.action === "update") return NextResponse.json({ record: await updateBeverage(id, body.patch || {}, actor, version, key) });
    return NextResponse.json({ record: await setLifecycle(id, lifecycleSchema.parse(body.lifecycle), actor, version, key) });
  } catch (error) { const result = beverageError(error); return NextResponse.json(result.body, { status: result.status }); }
}
