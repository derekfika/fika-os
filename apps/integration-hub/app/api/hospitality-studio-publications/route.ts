import type { NextRequest } from "next/server";
import { OAuth2Client } from "google-auth-library";
import { z } from "zod";
import { stableDocumentId } from "@fika/server-shared/stable-document-id";
import { maximumStudioPublicationBytes, studioPublicationDescriptor } from "../../../../shared/hospitality-menu-studio-publication";
import { studioPublicationAudience, studioReviewStaging } from "../../../../shared/hospitality-menu-studio-staging";
import { isStudioAuthHubRequestHost } from "@/lib/authmod-core/hospitality-studio-admission";
import { FirestoreAuthModRepository } from "@/lib/authmod-core/firestore-repository";
import { requireBoundFikaSession } from "@/lib/fika-session";
import { db } from "@/lib/firebase-admin";
import { isActiveOplocRecord } from "@/lib/hospitality-catalogue-oploc";
import { hospitalityPortalReadFromRecords } from "@/lib/hospitality-catalogue-service";
import { studioChoicePolicy, studioOfferingIsBookable } from "@/lib/hospitality-studio-commercial";
import { HubStudioPublications, studioActivationCommand } from "@/lib/hospitality-studio-publications";
import { studioPublicationAuthority } from "@/lib/hospitality-studio-publication-authority";
import { studioPilot } from "@/lib/hospitality-studio-pilot";
import { loadStudioProductActivationCatalogue } from "@/lib/mnk-booking-catalogue";
import type { CanonicalRecord } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const google = new OAuth2Client();
const envelope = z.strictObject({ manifest: studioPublicationDescriptor, body: z.string().max(maximumStudioPublicationBytes) });
const headers = { "Cache-Control": "private, no-store" };
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers });
const rejected = (status: number, code: string) => reply({ error: { code } }, status);
const store = () => new HubStudioPublications(db, studioReviewStaging.projectId);

export async function GET(request: NextRequest) {
  const pilot = studioPilot();
  if (!pilot || !isStudioAuthHubRequestHost(request.headers.get("host"))) return rejected(404, "STUDIO_ACTIVATION_DISABLED");
  try {
    const authorised = await db.runTransaction(async transaction => {
      const repository = new FirestoreAuthModRepository("studio-activation", undefined, transaction);
      const session = await requireBoundFikaSession(request, repository);
      const authorities = await Promise.all([
        studioPublicationAuthority(repository, session, "publish"),
        studioPublicationAuthority(repository, session, "activate-seasonal"),
        studioPublicationAuthority(repository, session, "activate-collection"),
        studioPublicationAuthority(repository, session, "activate-product"),
      ]);
      return { publish: authorities[0], activateSeasonal: authorities[1], activateCollection: authorities[2],
        activateProduct: authorities[3] && process.env.FIKA_STUDIO_HUB_PILOT_BOOKING_ENABLED === "true" &&
          process.env.FIKA_HOSPITALITY_EMAIL_DELIVERY_ENABLED === "false" };
    }, { readOnly: true });
    if (!Object.values(authorised).some(Boolean)) return rejected(403, "STUDIO_PUBLICATION_ACCESS_DENIED");
    return reply({ ...authorised, ...pilot, generation: await store().generation(pilot.oplocId) });
  } catch (error) { return respondError(error); }
}

export async function POST(request: NextRequest) {
  const pilot = studioPilot();
  if (!pilot || !isStudioAuthHubRequestHost(request.headers.get("host"))) return rejected(404, "STUDIO_ACTIVATION_DISABLED");
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") return rejected(415, "INVALID_CONTENT_TYPE");
  try {
    const bearer = request.headers.get("authorization");
    if (bearer !== null) {
      if (request.headers.has("origin") || request.headers.has("sec-fetch-site") || request.headers.has("cookie")) return rejected(403, "STUDIO_SERVER_REQUIRED");
      const token = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/.exec(bearer)?.[1];
      if (!token || token.length > 8192) return rejected(401, "STUDIO_CALLER_REQUIRED");
      const claims = await google.verifyIdToken({ idToken: token, audience: studioPublicationAudience }).then(ticket => ticket.getPayload()).catch(() => undefined);
      const { email, subject } = studioReviewStaging.studioIdentity;
      if (claims?.email !== email || claims.sub !== subject || claims.email_verified !== true) return rejected(401, "STUDIO_CALLER_REQUIRED");
      const input = envelope.parse(await readJson(request, maximumStudioPublicationBytes * 2 + 4096));
      if (input.manifest.menuId !== pilot.menuId) return rejected(403, "STUDIO_PUBLICATION_SCOPE_DENIED");
      return reply(await store().register(input));
    }
    if (request.headers.get("origin") !== studioReviewStaging.hubOrigin || request.headers.get("sec-fetch-site") === "cross-site") {
      return rejected(403, "STUDIO_ACTIVATION_ORIGIN_DENIED");
    }
    const command = studioActivationCommand.parse(await readJson(request, 8192));
    if (command.oplocId !== pilot.oplocId) return rejected(403, "STUDIO_ACTIVATION_SITE_DENIED");
    if (command.action === "activate-product" && (process.env.FIKA_STUDIO_HUB_PILOT_BOOKING_ENABLED !== "true" ||
        process.env.FIKA_HOSPITALITY_EMAIL_DELIVERY_ENABLED !== "false")) {
      return rejected(403, "STUDIO_PRODUCT_ACTIVATION_DISABLED");
    }
    return reply(await store().activate(command, async (transaction, action) => {
      const repository = new FirestoreAuthModRepository("studio-activation", undefined, transaction);
      const session = await requireBoundFikaSession(request, repository);
      if (!await studioPublicationAuthority(repository, session, action.action)) {
        throw Object.assign(new Error("Activation requires separate approval."), { status: 403, code: "STUDIO_ACTIVATION_ACCESS_DENIED" });
      }
      return session.authmodIdentityId;
    }, async (transaction, oplocId, itemIds, menu) => {
      if (menu.id !== pilot.menuId || menu.startDate < pilot.firstDate || menu.endDate > pilot.lastDate) {
        throw Object.assign(new Error("Publication is outside the staging scope."), { status: 403, code: "STUDIO_PUBLICATION_SCOPE_DENIED" });
      }
      const canonical = db.collection("integrationHubCanonical");
      const [site, ...items] = await transaction.getAll(canonical.doc(stableDocumentId(oplocId)),
        ...itemIds.map(id => canonical.doc(stableDocumentId(id))));
      const records = items.map(item => item.data() as CanonicalRecord | undefined);
      if (!site.exists || site.data()?.canonicalId !== oplocId || !isActiveOplocRecord(site.data() as CanonicalRecord) ||
          records.some((record, index) => !record || record.canonicalId !== itemIds[index] || record.entityType !== "Hospitality Menu Item" ||
            record.lifecycleStatus !== "published" || record.publicationStatus !== "published" || record.record.lifecycleState !== "active")) {
        throw Object.assign(new Error("Canonical Studio catalogue scope is invalid."), { status: 422, code: "STUDIO_ACTIVATION_CATALOGUE_INVALID" });
      }
      if (command.action === "activate-product") {
        const item = records[0];
        if (!item || records.length !== 1) throw invalidProductOffering();
        const catalogue = await loadStudioProductActivationCatalogue(item, oplocId, async (field, ids) => {
          const snapshot = await transaction.get(canonical.where(field, "in", ids).limit(501));
          if (snapshot.size > 500) throw invalidProductOffering();
          return snapshot.docs.map(document => document.data() as CanonicalRecord);
        });
        const { offerings } = hospitalityPortalReadFromRecords(catalogue, { oplocId, serviceDate: menu.startDate });
        const effective = offerings.find(offering => offering.itemId === item.canonicalId);
        if (!effective || !studioOfferingIsBookable(effective, menu.startDate) || !studioChoicePolicy(effective.configuration).replacesChoiceGroupId) {
          throw invalidProductOffering();
        }
      }
    }, command.action === "activate-product" ? pilot : undefined));
  } catch (error) { return respondError(error); }
}

function invalidProductOffering() {
  return Object.assign(new Error("The product has no verified Studio-compatible Offering for this site and date."),
    { status: 422, code: "STUDIO_PRODUCT_OFFERING_UNAVAILABLE" });
}

async function readJson(request: Request, limit: number): Promise<unknown> {
  const large = () => Object.assign(new Error("Publication request is too large."), { status: 413, code: "STUDIO_PUBLICATION_TOO_LARGE" });
  if (!request.body || Number(request.headers.get("content-length")) > limit) throw large();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw large();
      chunks.push(value);
    }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, size))) as unknown;
  } finally {
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

function respondError(error: unknown) {
  if (error instanceof z.ZodError || error instanceof SyntaxError) return rejected(422, "STUDIO_PUBLICATION_REQUEST_INVALID");
  const problem = error as { status?: number; code?: string };
  return rejected(problem.status || 503, problem.code || "STUDIO_PUBLICATION_UNAVAILABLE");
}
