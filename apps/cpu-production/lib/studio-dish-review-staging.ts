import { z } from "zod";
import { studioReviewAudience, studioReviewStaging } from "../../shared/hospitality-menu-studio-staging";
import { studioDishReviewRequestSchema, studioDishReviewSubjectSchema, type StudioDishReviewStore } from "./studio-dish-review";

const maximumBytes = studioReviewStaging.maximumRequestBytes;
const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
const bodySchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("submit"), request: studioDishReviewRequestSchema.strict() }),
  z.strictObject({ action: z.literal("status"), subject: studioDishReviewSubjectSchema }),
]);

type Dependencies = {
  env: Record<string, string | undefined>;
  verifyCaller: (token: string, audience: string) => Promise<{ sub?: string; email?: string; email_verified?: boolean } | undefined>;
  store: () => Promise<Pick<StudioDishReviewStore, "register" | "readiness">>;
};

function refusal(status: number, code: string) {
  return Response.json({ code }, { status, headers });
}

async function readBody(request: Request) {
  if (!request.body || Number(request.headers.get("content-length")) > maximumBytes) return undefined;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return Buffer.concat(chunks, size).toString("utf8");
      size += value.byteLength;
      if (size > maximumBytes) return undefined;
      chunks.push(value);
    }
  } finally {
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export function stagingStudioReviewEnabled(env: Record<string, string | undefined> = process.env) {
  const { projectId, cpuOrigin, hubOrigin } = studioReviewStaging;
  return env.FIKA_CPU_STUDIO_REVIEW_ENABLED === "true" && env.FIKA_RUNTIME_MODE === "staging" &&
    env.FIREBASE_PROJECT_ID === projectId && env.CPU_PUBLIC_BASE_URL === cpuOrigin && env.FIKA_HUB_BASE_URL === hubOrigin &&
    !env.FIRESTORE_EMULATOR_HOST && !env.GOOGLE_APPLICATION_CREDENTIALS &&
    [env.GCLOUD_PROJECT, env.GOOGLE_CLOUD_PROJECT].every(project => !project || project === projectId);
}

export async function handleStagedStudioDishReview(request: Request, { env, verifyCaller, store }: Dependencies) {
  if (!stagingStudioReviewEnabled(env)) return refusal(404, "CPU_STUDIO_INTAKE_DISABLED");
  if (request.method !== "POST") return refusal(405, "CPU_STUDIO_METHOD_DENIED");
  if (request.headers.has("origin") || request.headers.has("sec-fetch-site") || request.headers.has("cookie")) {
    return refusal(403, "CPU_STUDIO_SERVER_REQUIRED");
  }
  const jwt = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/.exec(request.headers.get("authorization") || "")?.[1];
  if (!jwt || jwt.length > 8192) return refusal(401, "CPU_STUDIO_CALLER_REQUIRED");
  const caller = await verifyCaller(jwt, studioReviewAudience).catch(() => undefined);
  const { email, subject } = studioReviewStaging.studioIdentity;
  if (caller?.sub !== subject || caller.email !== email || caller.email_verified !== true) {
    return refusal(401, "CPU_STUDIO_CALLER_REQUIRED");
  }
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    return refusal(415, "INVALID_CONTENT_TYPE");
  }
  const raw = await readBody(request).catch(() => undefined);
  if (raw === undefined) return refusal(413, "CPU_STUDIO_REQUEST_TOO_LARGE");
  const input = bodySchema.safeParse(parseJson(raw));
  if (!input.success) return refusal(422, "CPU_STUDIO_REQUEST_INVALID");
  try {
    const cpu = await store();
    const result = input.data.action === "submit" ? await cpu.register(input.data.request) : await cpu.readiness(input.data.subject);
    return Response.json(result, { headers });
  } catch (error) {
    if ((error as { code?: string })?.code === "CPU_STUDIO_SOURCE_CONFLICT") return refusal(409, "CPU_STUDIO_SOURCE_CONFLICT");
    return refusal(503, "CPU_STUDIO_EVIDENCE_UNAVAILABLE");
  }
}

function parseJson(raw: string): unknown {
  try { return JSON.parse(raw); }
  catch { return null; }
}
