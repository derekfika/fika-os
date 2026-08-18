import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse } from "@/lib/api";
import { requireActor } from "@/lib/auth";
import { assertPermission } from "@/lib/authmod";
import { correctCanonicalRecord, getCanonicalStorageStatus, migrateCanonicalStorage, queryCanonicalRegistry } from "@/lib/repository";
import { redactCanonical } from "@/lib/redaction";

const Correction = z.object({
  canonicalId: z.string().min(8).max(160),
  expectedVersion: z.number().int().positive(),
  patch: z.record(z.string(), z.union([z.string().max(1000), z.boolean(), z.null()])),
  reason: z.string().trim().min(10).max(1000),
  lockFields: z.array(z.string()).max(50).optional(),
}).strict();

export async function GET(req: NextRequest) {
  try {
    const actor = await requireActor(req);
    assertPermission(actor, "canonical.view");
    const params = req.nextUrl.searchParams;
    const result = await queryCanonicalRegistry({
      search: params.get("search") || undefined,
      entityType: params.get("entityType") || undefined,
      provider: params.get("provider") || undefined,
      status: params.get("status") || undefined,
      site: params.get("site") || undefined,
      sort: (["name", "entityType", "updatedAt", "createdAt", "status"].includes(params.get("sort") || "") ? params.get("sort") : "name") as "name" | "entityType" | "updatedAt" | "createdAt" | "status",
      direction: params.get("direction") === "desc" ? "desc" : "asc",
      page: Number(params.get("page") || 1),
      pageSize: Number(params.get("pageSize") || 25),
    });
    return NextResponse.json({ ...result, records: result.records.map(record => redactCanonical(record, actor.role)), storage: await getCanonicalStorageStatus() });
  } catch (error) { return errorResponse(error); }
}

export async function PATCH(req: NextRequest) {
  try {
    const actor = await requireActor(req);
    assertPermission(actor, "canonical.edit");
    const correction = Correction.parse(await req.json());
    if (correction.lockFields?.length) assertPermission(actor, "canonical.lock");
    return NextResponse.json({ record: await correctCanonicalRecord(actor, correction) });
  } catch (error) { return errorResponse(error); }
}

export async function POST(req: NextRequest) {
  try {
    const actor = await requireActor(req);
    assertPermission(actor, "canonical.edit");
    const body = z.object({ action: z.literal("migrate-canonical-storage"), confirmation: z.literal("MIGRATE CANONICAL STORAGE") }).strict().parse(await req.json());
    void body;
    return NextResponse.json(await migrateCanonicalStorage(actor));
  } catch (error) { return errorResponse(error); }
}
