import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/api";
import { requireActor } from "@/lib/auth";
import { queryPublishedCanonical } from "@/lib/governance-repository";
import { redactCanonical } from "@/lib/redaction";
import { z } from "zod";
import { AcceptedCanonicalEntityTypes } from "@/lib/schemas";
import { assertPermission } from "@/lib/authmod";
import { withDataTrace } from "@fika/server-shared/data-source-meter-server";

const Query = z.object({ entityType: z.enum(AcceptedCanonicalEntityTypes).default("OPLOC"), locationType: z.enum(["Site", "Venue"]).optional(), limit: z.coerce.number().int().min(1).max(200).default(50), after: z.string().min(1).optional() }).strict();
async function handleGet(req: NextRequest) { try { const actor = await requireActor(req); const query = Query.parse(Object.fromEntries(req.nextUrl.searchParams)); assertPermission(actor, "canonical.view"); if (query.entityType === "Address") assertPermission(actor, "address.view"); const page = await queryPublishedCanonical(query); return NextResponse.json({ publicationBoundary: "published-accepted-canon-only", entityType: query.entityType, locationType: query.locationType, records: page.records.map(record => redactCanonical(record, actor.role)), nextCursor: page.nextCursor, brokenReferences: page.brokenReferences }); } catch (error) { return errorResponse(error); } }
export async function GET(req: NextRequest) { return withDataTrace({ app: "integration-hub", action: "integration-hub.canonical.load", path: req.nextUrl.pathname, requestId: req.headers.get("x-request-id") || undefined }, () => handleGet(req)); }
