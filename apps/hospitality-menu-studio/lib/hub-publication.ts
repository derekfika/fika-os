import { z } from "zod";
import { dateSchema, idSchema } from "./schema";
import { publicationDigest, type StudioPublicationDescriptor } from "../../shared/hospitality-menu-studio-publication";
import { studioPublicationAudience, studioReviewStaging } from "../../shared/hospitality-menu-studio-staging";
import { boundedPeerText, studioPeerToken } from "./studio-peer-token";
import { StudioProblem } from "./problem";
import { studioUpstream, studioUpstreamHeaders } from "./data-trace";

const authoritySchema = z.strictObject({
  publish: z.boolean(), activateSeasonal: z.boolean(), activateCollection: z.boolean(), activateProduct: z.boolean(),
  oplocId: idSchema, menuId: idSchema, firstDate: dateSchema, lastDate: dateSchema, generation: z.int().nonnegative(),
});
export type StudioPublicationPilot = z.infer<typeof authoritySchema>;

const activationReceipt = z.strictObject({ generation: z.number().int().positive(), publicationId: idSchema });

export async function readStudioPublicationPilot(cookie: string, fetcher: typeof fetch = fetch) {
  try {
    const response = await studioUpstream("hub.studio-publication-access", () => fetcher(studioPublicationAudience, {
      headers: { cookie, ...studioUpstreamHeaders() }, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(5000),
    }));
    if (!response.ok) return undefined;
    const result = authoritySchema.safeParse(JSON.parse(await boundedPeerText(response)));
    return result.success ? result.data : undefined;
  } catch { return undefined; }
}

export async function deliverStudioPublication(manifest: StudioPublicationDescriptor, body: string, fetcher: typeof fetch = fetch) {
  try {
    const identity = await studioPeerToken(studioPublicationAudience, fetcher);
    const response = await studioUpstream("hub.studio-publication-deliver", () => fetcher(studioPublicationAudience, {
      method: "POST", headers: { authorization: `Bearer ${identity}`, "content-type": "application/json", ...studioUpstreamHeaders() },
      body: JSON.stringify({ manifest, body }), cache: "no-store", redirect: "error", signal: AbortSignal.timeout(7000),
    }));
    if (!response.ok) throw Error();
    const received = z.strictObject({ publicationId: idSchema, contentHash: publicationDigest }).parse(JSON.parse(await boundedPeerText(response)));
    if (received.publicationId !== manifest.id || received.contentHash !== manifest.contentHash) throw Error();
  } catch {
    throw new StudioProblem(503, "STUDIO_PUBLICATION_DELIVERY_PENDING", "The publication is saved. Retry to deliver it to Hub.");
  }
}

export async function activateStudioProduct({ cookie, pilot, publicationId, commandId, expectedGeneration, reason }: {
  cookie: string;
  pilot: StudioPublicationPilot;
  publicationId: string;
  commandId: string;
  expectedGeneration: number;
  reason: string;
}, fetcher: typeof fetch = fetch) {
  if (!pilot.activateProduct || !/^publication-[a-f0-9]{32}-v[1-9][0-9]*$/.test(publicationId) ||
      !z.string().uuid().safeParse(commandId).success || !Number.isSafeInteger(expectedGeneration) ||
      expectedGeneration < 0 || expectedGeneration > pilot.generation || reason.trim().length < 3 || reason.length > 500) {
    throw new StudioProblem(403, "STUDIO_PRODUCT_ACTIVATION_SCOPE_DENIED", "Customer activation is outside the approved Hub scope.");
  }
  const command = {
    publicationId, oplocId: pilot.oplocId, expectedGeneration, commandId, confirmed: true,
    action: "activate-product", visibility: "customer", reason: reason.trim(),
  } as const;
  try {
    const response = await studioUpstream("hub.studio-product-activation", () => fetcher(studioPublicationAudience, {
      method: "POST",
      headers: { cookie, origin: studioReviewStaging.hubOrigin, "content-type": "application/json", ...studioUpstreamHeaders() },
      body: JSON.stringify(command), cache: "no-store", redirect: "error", signal: AbortSignal.timeout(7000),
    }));
    if (!response.ok) throw new StudioProblem(response.status, "STUDIO_PRODUCT_ACTIVATION_REJECTED", "Hub did not approve customer activation. Refresh the review and check the activation requirements.");
    const received = activationReceipt.parse(JSON.parse(await boundedPeerText(response)));
    if (received.publicationId !== publicationId) throw new Error("Hub returned a different activation publication.");
    return received;
  } catch (error) {
    if (error instanceof StudioProblem) throw error;
    throw new StudioProblem(503, "STUDIO_PRODUCT_ACTIVATION_UNCONFIRMED", "Hub did not confirm customer activation. Retry the same request to check its result.");
  }
}
