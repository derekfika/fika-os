import { z } from "zod";
import { dateSchema, idSchema } from "./schema";
import { publicationDigest, type StudioPublicationDescriptor } from "../../shared/hospitality-menu-studio-publication";
import { studioPublicationAudience } from "../../shared/hospitality-menu-studio-staging";
import { boundedPeerText, studioPeerToken } from "./studio-peer-token";
import { StudioProblem } from "./problem";

const authoritySchema = z.strictObject({
  publish: z.boolean(), activateSeasonal: z.boolean(), activateCollection: z.boolean(),
  oplocId: idSchema, menuId: idSchema, firstDate: dateSchema, lastDate: dateSchema, generation: z.int().nonnegative(),
});
export type StudioPublicationPilot = z.infer<typeof authoritySchema>;

export async function readStudioPublicationPilot(cookie: string, fetcher: typeof fetch = fetch) {
  try {
    const response = await fetcher(studioPublicationAudience, {
      headers: { cookie }, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return undefined;
    const result = authoritySchema.safeParse(JSON.parse(await boundedPeerText(response)));
    return result.success ? result.data : undefined;
  } catch { return undefined; }
}

export async function deliverStudioPublication(manifest: StudioPublicationDescriptor, body: string, fetcher: typeof fetch = fetch) {
  try {
    const identity = await studioPeerToken(studioPublicationAudience, fetcher);
    const response = await fetcher(studioPublicationAudience, {
      method: "POST", headers: { authorization: `Bearer ${identity}`, "content-type": "application/json" },
      body: JSON.stringify({ manifest, body }), cache: "no-store", redirect: "error", signal: AbortSignal.timeout(7000),
    });
    if (!response.ok) throw Error();
    const received = z.strictObject({ publicationId: idSchema, contentHash: publicationDigest }).parse(JSON.parse(await boundedPeerText(response)));
    if (received.publicationId !== manifest.id || received.contentHash !== manifest.contentHash) throw Error();
  } catch {
    throw new StudioProblem(503, "STUDIO_PUBLICATION_DELIVERY_PENDING", "The publication is saved. Retry to deliver it to Hub.");
  }
}
