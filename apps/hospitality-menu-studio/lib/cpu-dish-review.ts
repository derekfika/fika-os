import { z } from "zod";
import {
  sameStudioDishReviewSubject, validStudioDishSafetyFence,
  type StudioDishReviewRequest, type StudioDishReviewSubject, type StudioDishSafetyFence,
} from "../../shared/hospitality-menu-studio-safety";
import { studioReviewAudience, studioReviewStaging } from "../../shared/hospitality-menu-studio-staging";
import { StudioProblem } from "./problem";
import { idSchema, revisionSchema } from "./schema";

const metadataIdentity = "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity";
const jwt = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const subjectSchema = z.strictObject({ dishId: idSchema, revision: revisionSchema, sourceHash: z.string().regex(/^[a-f0-9]{64}$/) });
const statusSchema = z.strictObject({
  subject: subjectSchema, status: z.enum(["unverified", "in_review", "verified", "revoked"]), fence: z.unknown().optional(),
});

export function cpuDishReview(fetcher: typeof fetch = fetch) {
  const exchange = async (body: unknown) => {
    const wire = JSON.stringify(body);
    if (Buffer.byteLength(wire) > studioReviewStaging.maximumRequestBytes) {
      throw new StudioProblem(413, "DISH_REVIEW_TOO_LARGE", "This dish revision is too large to send to the CPU allergen checker.");
    }
    const url = new URL(metadataIdentity);
    url.searchParams.set("audience", studioReviewAudience);
    url.searchParams.set("format", "full");
    try {
      const tokenResponse = await fetcher(url, {
        headers: { "Metadata-Flavor": "Google" }, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(3000),
      });
      if (!tokenResponse.ok || tokenResponse.headers.get("Metadata-Flavor") !== "Google") throw unavailable();
      const token = (await boundedText(tokenResponse)).trim();
      if (!jwt.test(token)) throw unavailable();
      const claims = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
      const { email, subject } = studioReviewStaging.studioIdentity;
      if (claims.email !== email || claims.sub !== subject || claims.email_verified !== true ||
          claims.aud !== studioReviewAudience || claims.iss !== "https://accounts.google.com" ||
          !Number.isSafeInteger(claims.exp) || claims.exp <= Date.now() / 1000) throw unavailable();
      const response = await fetcher(studioReviewAudience, {
        method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json" },
        body: wire, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(5000),
      });
      if (response.status === 409) throw new StudioProblem(409, "DISH_REVIEW_CONFLICT", "CPU already has a different source for this revision. Reload the saved dish.");
      if (!response.ok || response.headers.get("content-type")?.split(";")[0].trim() !== "application/json") throw unavailable();
      return JSON.parse(await boundedText(response)) as unknown;
    } catch (error) {
      if (error instanceof StudioProblem) throw error;
      throw unavailable();
    }
  };
  return {
    async submit(request: StudioDishReviewRequest) {
      const response = z.strictObject({ subject: subjectSchema }).safeParse(await exchange({ action: "submit", request }));
      if (!response.success || !sameStudioDishReviewSubject(response.data.subject, request.subject)) throw unavailable();
      return response.data;
    },
    async status(subject: StudioDishReviewSubject) {
      try {
        const result = statusSchema.parse(await exchange({ action: "status", subject }));
        if (!sameStudioDishReviewSubject(result.subject, subject)) throw unavailable();
        if (result.status === "verified" || result.status === "revoked") {
          const fence = result.fence as StudioDishSafetyFence | undefined;
          if (!validStudioDishSafetyFence(fence, subject) || fence?.status !== (result.status === "verified" ? "current" : "revoked")) throw unavailable();
        } else if (result.fence !== undefined) throw unavailable();
        return { status: result.status };
      } catch { return { status: "unavailable" as const }; }
    },
  };
}

async function boundedText(response: Response) {
  const maximumBytes = 8192;
  if (!response.body || Number(response.headers.get("content-length")) > maximumBytes) throw unavailable();
  const reader = response.body.getReader();
  const bytes: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return Buffer.concat(bytes, size).toString("utf8");
      size += value.byteLength;
      if (size > maximumBytes) throw unavailable();
      bytes.push(value);
    }
  } finally {
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

function unavailable() {
  return new StudioProblem(503, "DISH_REVIEW_UNAVAILABLE", "The CPU allergen checker could not verify this saved revision.");
}
