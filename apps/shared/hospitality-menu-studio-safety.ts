import { createHash } from "node:crypto";

export const studioDishReviewRequests = "fikaStudioDishReviewRequestsV1";
export const studioDishSafetyFences = "fikaCpuStudioDishSafetyV1";
export const studioDishReviewRecords = "fikaCpuStudioDishReviewsV1";

export type StudioDishRevision = {
  id: string;
  version: number;
  name: string;
  category: string;
  temperature: "hot" | "cold" | null;
  customerDescription: string;
  kitchenDescription: string;
  assortment: {
    expectedTotal: number;
    unit: string;
    components: { id: string; name: string; quantity: number }[];
  } | null;
};

export type StudioDishReviewSubject = { dishId: string; revision: number; sourceHash: string };
export type StudioDishReviewRequest = {
  contract: "hospitality-menu-studio.dish-review-request.v1";
  subject: StudioDishReviewSubject;
  dish: StudioDishRevision;
  requestedAt: string;
  requestedBy: string;
};

export type StudioDishSafetyFence = {
  contract: "cpu-production.studio-dish-safety.v1";
  subject: StudioDishReviewSubject;
  status: "current" | "revoked";
  releaseId: string;
  matrixHash: string;
  changedAt: string;
};

export type StudioDishSafetyStatus = "unverified" | "in_review" | "verified" | "revoked" | "unavailable";

export const studioDishSignatureRoles = ["production_chef", "head_chef_site_manager"] as const;
export type StudioDishSignatureRole = (typeof studioDishSignatureRoles)[number];
export type StudioDishReleaseSignature = {
  role: StudioDishSignatureRole; actorId: string; eventId: string; signedAt: string; matrixHash: string; sourceHash: string; signatureHash: string;
};
export type StudioDishReleaseHeader = StudioDishSafetyFence & { signatures: StudioDishReleaseSignature[] };

export function studioDishReviewKey(dishId: string, revision: number) {
  return sha256([dishId, revision]);
}

export function studioDishReviewSubject(dish: StudioDishRevision): StudioDishReviewSubject {
  const { id, version, name, category, temperature, customerDescription, kitchenDescription, assortment } = dish;
  return {
    dishId: id,
    revision: version,
    sourceHash: sha256([
      "hospitality-menu-studio.dish.v1", id, version, name, category, temperature, customerDescription, kitchenDescription,
      assortment && [assortment.expectedTotal, assortment.unit, assortment.components.map(row => [row.id, row.name, row.quantity])],
    ]),
  };
}

export function sameStudioDishReviewSubject(left: StudioDishReviewSubject | undefined, right: StudioDishReviewSubject) {
  return left?.dishId === right.dishId && left.revision === right.revision && left.sourceHash === right.sourceHash;
}

export function validStudioDishSafetyFence(value: StudioDishSafetyFence | undefined, subject: StudioDishReviewSubject) {
  return Boolean(value?.contract === "cpu-production.studio-dish-safety.v1" && sameStudioDishReviewSubject(value.subject, subject)
    && (value.status === "current" || value.status === "revoked") && /^cpu-studio-dish-release:[a-f0-9]{64}:v[1-9][0-9]*$/.test(value.releaseId)
    && value.releaseId.startsWith(`cpu-studio-dish-release:${studioDishReviewKey(subject.dishId, subject.revision)}:v`)
    && /^[a-f0-9]{64}$/.test(value.matrixHash) && Number.isFinite(Date.parse(value.changedAt)));
}

export function studioDishReleaseVersion(fence: StudioDishSafetyFence) { return fence.releaseId.split(":v").at(-1)!; }

export function matchesStudioDishRelease(value: StudioDishReleaseHeader | undefined, fence: StudioDishSafetyFence) {
  return Boolean(validStudioDishSafetyFence(value, fence.subject) && value && value.status === "current" && value.releaseId === fence.releaseId
    && value.matrixHash === fence.matrixHash && Array.isArray(value.signatures) && value.signatures.length === studioDishSignatureRoles.length
    && value.signatures.every(signature => Boolean(signature) && typeof signature.actorId === "string" && signature.actorId
      && /^[a-f0-9-]{36}$/i.test(signature.eventId) && /^[a-f0-9]{64}$/.test(signature.signatureHash)
      && signature.matrixHash === fence.matrixHash && signature.sourceHash === fence.subject.sourceHash
      && Number.isFinite(Date.parse(signature.signedAt)))
    && studioDishSignatureRoles.every(role => value.signatures.some(signature => signature.role === role))
    && value.signatures[0].actorId !== value.signatures[1].actorId && value.signatures[0].eventId !== value.signatures[1].eventId);
}

export function matchesStudioDishSignatureEvent(event: (StudioDishReleaseSignature & { action: string; source: string }) | undefined, signature: StudioDishReleaseSignature) {
  return event?.action === "sign" && event.source === "cpu-production" && event.role === signature.role && event.actorId === signature.actorId
    && event.eventId === signature.eventId && event.signedAt === signature.signedAt && event.matrixHash === signature.matrixHash
    && event.sourceHash === signature.sourceHash && event.signatureHash === signature.signatureHash;
}

function sha256(value: unknown) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
