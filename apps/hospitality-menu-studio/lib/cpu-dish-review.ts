import { z } from "zod";
import {
  sameStudioDishReviewSubject, validStudioDishSafetyFence,
  type StudioDishReviewRequest, type StudioDishReviewSubject, type StudioDishSafetyFence,
} from "../../shared/hospitality-menu-studio-safety";
import { studioReviewAudience, studioReviewStaging } from "../../shared/hospitality-menu-studio-staging";
import { StudioProblem } from "./problem";
import { idSchema, revisionSchema } from "./schema";
import { boundedPeerText, studioPeerToken } from "./studio-peer-token";
const subjectSchema = z.strictObject({ dishId: idSchema, revision: revisionSchema, sourceHash: z.string().regex(/^[a-f0-9]{64}$/) });
const statusSchema = z.strictObject({
  subject: subjectSchema, status: z.enum(["unverified", "in_review", "verified", "revoked"]), fence: z.unknown().optional(),
});

export function cpuDishReview(fetcher: typeof fetch = fetch) {
  let tokenPromise: Promise<string> | undefined;
  const exchange = async (body: unknown) => {
    const wire = JSON.stringify(body);
    if (Buffer.byteLength(wire) > studioReviewStaging.maximumRequestBytes) {
      throw new StudioProblem(413, "DISH_REVIEW_TOO_LARGE", "This dish revision is too large to send to the CPU allergen checker.");
    }
    try {
      const token = await (tokenPromise ??= studioPeerToken(studioReviewAudience, fetcher));
      const response = await fetcher(studioReviewAudience, {
        method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json" },
        body: wire, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(5000),
      });
      if (response.status === 409) throw new StudioProblem(409, "DISH_REVIEW_CONFLICT", "CPU already has a different source for this revision. Reload the saved dish.");
      if (!response.ok || response.headers.get("content-type")?.split(";")[0].trim() !== "application/json") throw unavailable();
      return JSON.parse(await boundedPeerText(response)) as unknown;
    } catch (error) {
      if (error instanceof StudioProblem) throw error;
      throw unavailable();
    }
  };
  const evidence = async (subject: StudioDishReviewSubject) => {
      try {
        const result = statusSchema.parse(await exchange({ action: "status", subject }));
        if (!sameStudioDishReviewSubject(result.subject, subject)) throw unavailable();
        if (result.status === "verified" || result.status === "revoked") {
          const fence = result.fence as StudioDishSafetyFence | undefined;
          if (!fence || !validStudioDishSafetyFence(fence, subject) || fence.status !== (result.status === "verified" ? "current" : "revoked")) throw unavailable();
          return { status: result.status, fence };
        } else if (result.fence !== undefined) throw unavailable();
        return { status: result.status };
      } catch { return { status: "unavailable" as const }; }
  };
  return {
    async submit(request: StudioDishReviewRequest) {
      const response = z.strictObject({ subject: subjectSchema }).safeParse(await exchange({ action: "submit", request }));
      if (!response.success || !sameStudioDishReviewSubject(response.data.subject, request.subject)) throw unavailable();
      return response.data;
    },
    async status(subject: StudioDishReviewSubject) { return { status: (await evidence(subject)).status }; },
    evidence,
  };
}

function unavailable() {
  return new StudioProblem(503, "DISH_REVIEW_UNAVAILABLE", "The CPU allergen checker could not verify this saved revision.");
}
