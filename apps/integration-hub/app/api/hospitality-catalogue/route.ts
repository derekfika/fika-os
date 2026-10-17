import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse } from "@/lib/api";
import { requireActor } from "@/lib/auth";
import { assertPermission } from "@/lib/authmod";
import { runBulkCatalogueUpdate, runCatalogueCommand, type BulkSpec, type CatalogueCommand } from "@/lib/hospitality-catalogue-admin";
import { loadCataloguePayload, loadCatalogueRows } from "@/lib/hospitality-catalogue-loader";
import { ROUTING_CHOICES } from "@/lib/hospitality-catalogue-types";

const Id = z.string().min(8).max(160);
const Version = z.number().int().positive();
const Price = z.object({ amount: z.number().finite().nonnegative(), vatRate: z.number().min(0).max(1).optional() }).strict();
const Routing = z.enum(ROUTING_CHOICES);
const Command = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create-item"), requestId: z.string().min(8).max(80), name: z.string().trim().min(1).max(240), category: z.string().trim().min(1).max(160), description: z.string().max(4000).optional(), routing: Routing, defaultPrice: Price.optional(), defaultMinimumQuantity: z.number().int().positive().optional(), oplocIds: z.array(Id).min(1).max(60), providerMappings: z.array(z.object({ provider: z.string().min(1).max(160), sourceItemId: z.string().min(1).max(240), sourceVersion: z.string().max(240).optional() }).strict()).max(20).optional() }).strict(),
  z.object({ action: z.literal("update-item"), itemId: Id, expectedVersion: Version, name: z.string().trim().min(1).max(240), category: z.string().trim().min(1).max(160), description: z.string().max(4000).optional(), defaultMinimumQuantity: z.number().int().positive().nullable(), defaultPrice: Price.optional() }).strict(),
  z.object({ action: z.literal("set-default-price"), itemId: Id, expectedVersion: Version, price: Price }).strict(),
  z.object({ action: z.literal("set-routing"), itemId: Id, routing: Routing, expectedRoutingVersion: z.number().int().nonnegative() }).strict(),
  z.object({ action: z.literal("set-item-status"), itemId: Id, expectedVersion: Version, status: z.enum(["active", "archived"]) }).strict(),
  z.object({ action: z.literal("add-offering"), itemId: Id, expectedVersion: Version, oplocId: Id, operationalAreaId: Id.optional(), mode: z.enum(["standard", "quote_only"]).optional() }).strict(),
  z.object({ action: z.literal("set-offering-status"), offeringId: Id, expectedVersion: Version, status: z.enum(["active", "archived"]) }).strict(),
  z.object({ action: z.literal("set-offering-override"), offeringId: Id, expectedVersion: Version, price: Price.nullable().optional(), minimumQuantity: z.number().int().positive().nullable().optional(), displayName: z.string().max(240).nullable().optional(), description: z.string().max(1000).nullable().optional() }).strict(),
  z.object({ action: z.literal("adopt-company-default"), itemId: Id, expectedVersion: Version, price: Price, minimumQuantity: z.number().int().positive().nullable().optional(), confirmed: z.boolean() }).strict(),
  z.object({ action: z.literal("merge-items"), survivorItemId: Id, sourceItemIds: z.array(Id).min(1).max(10), expectedVersions: z.record(z.string(), Version), groupId: z.string().max(64).optional() }).strict(),
  z.object({ action: z.literal("record-review-decision"), memberIds: z.array(Id).min(2).max(12), decision: z.enum(["keep_separate", "defer"]) }).strict(),
]);

const BulkCommand = z.object({
  action: z.literal("bulk-update"), operationId: z.string().min(8).max(80), itemIds: z.array(Id).min(1).max(50),
  expectedVersions: z.record(z.string(), Version), expectedRoutingVersions: z.record(z.string(), z.number().int().nonnegative()).optional(),
  production: Routing.optional(), price: Price.optional(),
  minimum: z.discriminatedUnion("mode", [z.object({ mode: z.literal("set"), value: z.number().int().positive() }).strict(), z.object({ mode: z.literal("clear") }).strict()]).optional(),
  sites: z.object({ mode: z.enum(["add", "remove", "replace"]), oplocIds: z.array(Id).min(1).max(100) }).strict().optional(), archive: z.boolean().optional(),
}).strict();

const noStore = { headers: { "Cache-Control": "no-store, max-age=0" } };

export async function GET(request: NextRequest) {
  try {
    const actor = await requireActor(request);
    assertPermission(actor, "canonical.view");
    return NextResponse.json(await loadCataloguePayload(actor), noStore);
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: NextRequest) {
  try {
    const actor = await requireActor(request);
    assertPermission(actor, "hospitality.catalogue.manage");
    const body = await request.json();
    if (body?.action === "bulk-update") {
      const outcome = await runBulkCatalogueUpdate(actor, BulkCommand.parse(body) as unknown as BulkSpec);
      const touched = outcome.results.filter(result => result.status === "applied" || result.status === "already_applied").map(result => result.itemId);
      return NextResponse.json({ message: outcome.message, bulk: outcome, rows: touched.length ? await loadCatalogueRows(touched) : [] }, noStore);
    }
    const result = await runCatalogueCommand(actor, Command.parse(body) as CatalogueCommand);
    // Merges and review decisions change group structure: return a full reload. Everything else refreshes only the touched items.
    if (result.reload) return NextResponse.json({ message: result.message, payload: await loadCataloguePayload(actor) }, noStore);
    return NextResponse.json({ message: result.message, rows: await loadCatalogueRows(result.itemIds) }, noStore);
  } catch (error) { return errorResponse(error); }
}
