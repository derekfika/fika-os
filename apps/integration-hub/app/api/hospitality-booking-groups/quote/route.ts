import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireActor } from "@/lib/auth";
import { requireFikaSession } from "@/lib/fika-session";
import { FirestoreAuthModRepository } from "@/lib/authmod-core";
import { assertHospitalityBookingMutationAccess } from "@/lib/hospitality-booking-authorization";
import { getDashboardQuoteSettingsForBooking } from "@/lib/hospitality-booking-service";
import { generateHospitalityGroupQuote } from "@/lib/hospitality-group-quote-workflow";
import { firestoreGroupQuoteStore } from "@/lib/hospitality-group-quote-store";
import { groupQuoteDriveArtifact } from "@/lib/hospitality-group-quote-artifact";
import { resolveDriveOwner } from "@fika/server-shared/drive-owner";
import { withDataTrace } from "@fika/server-shared/data-source-meter-server";
import { errorResponse } from "@/lib/api";
import { queueGroupConfirmation } from "@/lib/booking-group-confirmation";

const Command = z.object({ bookingGroupId: z.string().trim().min(1).max(160), expectedVersion: z.number().int().nonnegative(), expectedSourceHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export async function POST(request: NextRequest) {
  return withDataTrace({ app: "integration-hub", action: "hospitality.group-quote", path: "/api/hospitality-booking-groups/quote", requestId: request.headers.get("x-request-id") || undefined }, async () => {
    try {
      const actor = await requireActor(request);
      const session = await requireFikaSession(request);
      const command = Command.parse(await request.json());
      const repository = new FirestoreAuthModRepository();
      const principal = { type: "interactive" as const, id: session.authmodIdentityId, displayName: session.displayName, email: session.email, identityKind: session.identityKind };
      const quote = await generateHospitalityGroupQuote(command, {
        actorId: actor.uid, store: firestoreGroupQuoteStore, artifact: groupQuoteDriveArtifact(),
        authorize: async children => {
          // Membership validation requires one shared OPLOC. Authorise each distinct scope once, covering every child.
          const scopes = new Map(children.map(child => [child.service.oplocId, child]));
          for (const child of scopes.values()) await assertHospitalityBookingMutationAccess(repository, principal, child, actor.role === "integration-admin" || actor.role === "reviewer");
        },
        target: async booking => {
          const settings = await getDashboardQuoteSettingsForBooking(booking);
          const owner = resolveDriveOwner({ type: "oploc-workspace", oplocId: booking.service.oplocId! });
          const configured = settings.googleQuoteFolderId || settings.googleDriveFolderId || owner.configuredRootFolderId || "";
          const folderId = configured.match(/\/folders\/([A-Za-z0-9_-]+)/)?.[1] || configured.trim();
          return { folderId, oplocId: booking.service.oplocId! };
        },
      });
      // Reconciliation trigger: a completed group quote can be what makes the last in-house service eligible. Idempotent; never fails the quote.
      if (quote.status === "complete") { try { await queueGroupConfirmation(command.bookingGroupId); } catch (error) { console.error("hospitality.group-confirmation.reconcile-failed", { bookingGroupId: command.bookingGroupId, message: error instanceof Error ? error.message : String(error) }); } }
      return NextResponse.json({ quote: { id: quote.id, revision: quote.revision, status: quote.status, ...(quote.status === "complete" ? { driveUrl: quote.artifact.driveUrl } : {}), ...(quote.error ? { error: quote.error } : {}) } }, { status: quote.status === "complete" ? 200 : 202 });
    } catch (error) { return errorResponse(error); }
  });
}
