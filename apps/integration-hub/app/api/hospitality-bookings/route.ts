import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse } from "@/lib/api";
import { requireActor } from "@/lib/auth";
import { FirestoreAuthModRepository } from "@/lib/authmod-core";
import { resolveUserAccess } from "@/lib/authmod-core/evaluator";
import { requireFikaSession } from "@/lib/fika-session";
import { assertPermission } from "@/lib/authmod";
import { assertHospitalityBookingMutationAccess } from "@/lib/hospitality-booking-authorization";
import { bookingWorkspace, createProductionOrder, executeBookingWorkflow, getBookingByCanonicalId, saveDashboardQuoteSettings } from "@/lib/hospitality-booking-service";

const Base = { canonicalId: z.string().min(8), expectedVersion: z.number().int().positive() };
const Change = z.discriminatedUnion("action", [
  z.object({ ...Base, action: z.literal("review"), checks: z.object({ commercialIntent: z.boolean().optional(), serviceTiming: z.boolean().optional(), deliveryContext: z.boolean().optional(), dietaryRequirements: z.boolean().optional() }).default({}), notes: z.string().trim().max(1000).optional() }).strict(),
  z.object({ ...Base, action: z.literal("quote"), regenerate: z.boolean().optional() }).strict(),
  z.object({ ...Base, action: z.literal("quote-pdf-status"), revisionId: z.string().min(8), status: z.enum(["pending", "saved", "failed"]), driveFileId: z.string().trim().min(1).optional(), driveUrl: z.string().url().optional(), error: z.string().trim().max(1000).optional() }).strict(),
  z.object({ ...Base, action: z.literal("amend"), reason: z.string().trim().min(3).max(1000), patch: z.object({ client: z.object({ name: z.string().trim().min(1), email: z.string().trim().email(), phone: z.string().trim().max(80).optional(), companyName: z.string().trim().min(1), requester: z.object({ name: z.string().trim().min(1), email: z.string().trim().email(), phone: z.string().trim().max(80).optional(), companyName: z.string().trim().min(1) }).optional(), clientName: z.string().trim().min(1).optional(), clientCompany: z.string().trim().min(1).optional(), invoiceReference: z.string().trim().max(200).optional() }).strict(), service: z.object({ eventDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), startTime: z.string().regex(/^\d{2}:\d{2}$/), endTime: z.string().regex(/^\d{2}:\d{2}$/).optional(), guestCount: z.number().int().positive(), floorLevel: z.string().trim().max(200).optional(), roomOrArea: z.string().trim().max(200).optional(), deliveryPoint: z.string().trim().max(200).optional(), onsiteContactName: z.string().trim().max(200).optional(), onsiteContactPhone: z.string().trim().max(80).optional() }).strict(), order: z.object({ eventType: z.string().trim().max(120).optional(), items: z.array(z.object({ itemId: z.string().trim().min(1), itemName: z.string().trim().max(300).optional(), category: z.string().trim().max(120).optional(), description: z.string().trim().max(4000).optional(), servingInfo: z.string().trim().max(500).optional(), unitPrice: z.number().min(0), quantity: z.number().int().min(0), choices: z.array(z.unknown()).optional(), comments: z.string().trim().max(2000).optional() }).strict()).min(1) }).strict(), notes: z.string().trim().max(4000).optional(), deliveryChargeRequired: z.boolean().optional() }).strict() }).strict(),
  z.object({ ...Base, action: z.literal("approve"), quoteRevisionId: z.string().min(8) }).strict(),
  z.object({ ...Base, action: z.literal("production-handoff") }).strict(),
  z.object({ ...Base, action: z.literal("complete"), notes: z.string().trim().max(1000).optional() }).strict(),
  z.object({ ...Base, action: z.literal("cancel"), reason: z.string().trim().min(3).max(1000), removeCalendar: z.boolean().optional(), cancelProduction: z.boolean().optional(), notify: z.boolean().optional() }).strict(),
]);
const Settings = z.object({ action: z.literal("save-quote-settings"), dashboardId: z.string().min(3), managementFee: z.object({ mode: z.enum(["fixed", "percentage"]), value: z.number().min(0), label: z.string().trim().min(1).max(100) }).strict(), deliveryCharge: z.object({ enabled: z.boolean(), amount: z.number().min(0), label: z.string().trim().min(1).max(100) }).strict(), buildingCharges: z.object({ enabled: z.boolean(), housekeeping: z.object({ hourly: z.number().min(0), label: z.string().trim().min(1).max(100) }).strict(), security: z.object({ hourly: z.number().min(0), minimumHours: z.number().min(0), label: z.string().trim().min(1).max(100) }).strict(), aircon: z.object({ hourly: z.number().min(0), afterHour: z.number().min(0).max(23), label: z.string().trim().min(1).max(100) }).strict(), venueHire: z.object({ enabled: z.boolean(), amount: z.number().min(0), label: z.string().trim().min(1).max(100) }).strict() }).strict().optional(), vatRate: z.number().min(0).max(1), googleDriveFolderId: z.string().trim().max(200).optional(), googleMenuTemplateId: z.string().trim().max(200).optional(), googleMenuFolderId: z.string().trim().max(200).optional(), googleQuoteFolderId: z.string().trim().max(200).optional(), googleMatrixFolderId: z.string().trim().max(200).optional() }).strict();
export async function GET(request: NextRequest) { try {
  const actor = await requireActor(request);
  assertPermission(actor, "canonical.view");
  const site = request.nextUrl.searchParams.get("site") || undefined;
  const oploc = request.nextUrl.searchParams.get("oploc") || undefined;
  const includeArchive = request.nextUrl.searchParams.get("archive") === "true";
  if (site) {
    if (!oploc) throw Object.assign(new Error("A governed Hospitality OPLOC is required for a scoped dashboard read."), { status: 400 });
    const session = await requireFikaSession(request);
    const repository = new FirestoreAuthModRepository();
    const principal = { type: "interactive" as const, id: session.authmodIdentityId, displayName: session.displayName, email: session.email, identityKind: session.identityKind };
    const decision = await resolveUserAccess(repository, { principal, appId: "hospitality-booking", oplocId: oploc });
    if (!decision.allowed) throw Object.assign(new Error("That Hospitality location is not authorised for your account."), { status: 403 });
  }
  return NextResponse.json(await bookingWorkspace(site, oploc, includeArchive), { headers: { "Cache-Control": "no-store, max-age=0" } });
} catch (error) { return errorResponse(error); } }
export async function POST(request: NextRequest) { try {
  const actor = await requireActor(request);
  const raw = await request.json();
  if (raw?.action === "save-quote-settings") {
    assertPermission(actor, "canonical.edit");
    return NextResponse.json({ quoteSettings: await saveDashboardQuoteSettings(actor, Settings.parse(raw)) });
  }
  const change = Change.parse(raw);
  const session = await requireFikaSession(request);
  const repository = new FirestoreAuthModRepository();
  const principal = { type: "interactive" as const, id: session.authmodIdentityId, displayName: session.displayName, email: session.email, identityKind: session.identityKind };
  const booking = await getBookingByCanonicalId(change.canonicalId);
  await assertHospitalityBookingMutationAccess(repository, principal, booking, actor.role === "integration-admin" || actor.role === "reviewer");
  if (change.action === "production-handoff") return NextResponse.json(await createProductionOrder(actor, change.canonicalId, change.expectedVersion));
  return NextResponse.json(await executeBookingWorkflow(actor, change.canonicalId, change.expectedVersion, change));
} catch (error) { return errorResponse(error); } }
