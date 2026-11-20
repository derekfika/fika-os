import type { NextRequest } from "next/server";
import { errorResponse } from "../../../../../lib/api";
import { requireCpuStudioReviewer } from "../../../../../lib/cpu-access-client";
import { getHubBaseUrl } from "../../../../../lib/hub-url";
import { getFikaRuntimeConfig } from "../../../../../lib/runtime-config";
import { studioDishId, studioDishRevision, studioDishReviewCommand, StudioDishReviewStore } from "../../../../../lib/studio-dish-review";
import { stagingStudioReviewEnabled } from "../../../../../lib/studio-dish-review-staging";
import { studioReviewStaging } from "../../../../../../shared/hospitality-menu-studio-staging";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ dishId: string; revision: string }> };
const noStore = { "Cache-Control": "private, no-store" };
const loopback = /^(?:127\.0\.0\.1|localhost):\d+$/;

function checkRuntime(request: NextRequest) {
  if (stagingStudioReviewEnabled()) return studioReviewStaging.cpuOrigin;
  const config = getFikaRuntimeConfig();
  const host = request.headers.get("host") || new URL(request.url).host;
  if (config.mode !== "local" || config.projectId !== "demo-fika-os" || !loopback.test(config.firestoreHost)
    || !loopback.test(host) || !/^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/.test(getHubBaseUrl())) {
    throw Object.assign(new Error("Studio dish review is unavailable in this environment."), { status: 503, code: "CPU_STUDIO_REVIEW_UNAVAILABLE" });
  }
  return `http://${host}`;
}

export async function GET(request: NextRequest, context: Context) {
  return handle(request, context);
}

export async function POST(request: NextRequest, context: Context) {
  return handle(request, context);
}

async function handle(request: NextRequest, context: Context) {
  try {
    const origin = checkRuntime(request);
    if (request.method === "POST" && (request.headers.get("origin") !== origin || request.headers.get("sec-fetch-site") === "cross-site")) {
      throw Object.assign(new Error("Studio review changes must come from this site."), { status: 403, code: "CPU_STUDIO_ORIGIN_DENIED" });
    }
    const actor = await requireCpuStudioReviewer(request);
    const params = await context.params;
    const dishId = studioDishId.parse(params.dishId);
    const revision = studioDishRevision.parse(params.revision);
    const { db } = await import("../../../../../lib/firebase-admin");
    const store = new StudioDishReviewStore(db);
    if (request.method === "GET") return Response.json(await store.read(dishId, revision), { headers: noStore });
    if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
      throw Object.assign(new Error("This request requires JSON."), { status: 415, code: "INVALID_CONTENT_TYPE" });
    }
    if (Number(request.headers.get("content-length")) > 270_000) throw tooLarge();
    const body = await request.text();
    if (Buffer.byteLength(body) > 270_000) throw tooLarge();
    let data: unknown;
    try { data = JSON.parse(body); }
    catch { throw Object.assign(new Error("The review request could not be read."), { status: 400, code: "INVALID_REQUEST" }); }
    return Response.json(await store.apply(dishId, revision, actor.uid, studioDishReviewCommand.parse(data)), { headers: noStore });
  } catch (error) {
    const response = errorResponse(error);
    response.headers.set("Cache-Control", noStore["Cache-Control"]);
    return response;
  }
}

function tooLarge() {
  return Object.assign(new Error("This review request exceeds the storage limit."), { status: 413, code: "CPU_STUDIO_REVIEW_TOO_LARGE" });
}
