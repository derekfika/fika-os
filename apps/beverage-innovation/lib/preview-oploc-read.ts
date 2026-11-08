import { Buffer } from "node:buffer";
import { z } from "zod";
import { beveragePreviewCookieName, checkBeveragePreviewAccess, type BeveragePreviewClaims } from "./preview-auth";
import {
  BEVERAGE_PREVIEW_HOST, BEVERAGE_PREVIEW_OPLOC_PATH, BEVERAGE_STAGING_HUB_ORIGIN,
  canonicalPreviewOplocId, configuredPreviewOplocIds,
} from "./preview-routing";

const AUDIENCE = `${BEVERAGE_STAGING_HUB_ORIGIN}/api/internal/beverage/reference`;
const SERVICE_EMAIL = "beverage-preview-runtime@fika-os-dev.iam.gserviceaccount.com";
const SERVICE_SUBJECT = "104628272102873149105";
const METADATA_IDENTITY = "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity";
const JWT = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", Vary: "Cookie" };
const site = z.object({ id: z.string().regex(canonicalPreviewOplocId), label: z.string().trim().min(1).max(240) }).strict();
const responseSchema = z.object({ readOnly: z.literal(true), oplocs: z.array(site).min(1).max(100) }).strict();

type PreviewRequest = Request & { cookies: { get(name: string): { value?: string } | undefined } };
type PreviewOplocDeps = {
  env: NodeJS.ProcessEnv;
  fetch: typeof fetch;
  verifyPreviewCookie?: (cookie: string) => Promise<BeveragePreviewClaims>;
};

function refuse(status: number, code: string) {
  return Response.json({ error: { code } }, { status, headers });
}

async function boundedText(response: Response, cap: number) {
  if (!response.body || Number(response.headers.get("content-length")) > cap) throw new Error("Invalid response size.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > cap) throw new Error("Invalid response size.");
      chunks.push(value);
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, size));
  } finally {
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

async function serviceIdentityToken(fetcher: typeof fetch) {
  const url = new URL(METADATA_IDENTITY);
  url.searchParams.set("audience", AUDIENCE);
  url.searchParams.set("format", "full");
  const response = await fetcher(url, {
    method: "GET", headers: { "Metadata-Flavor": "Google" }, cache: "no-store", redirect: "error",
    signal: AbortSignal.timeout(3000),
  });
  if (!response.ok || response.redirected || response.headers.get("Metadata-Flavor") !== "Google") throw new Error("Service identity unavailable.");
  const token = (await boundedText(response, 8192)).trim();
  if (!JWT.test(token)) throw new Error("Service identity unavailable.");
  // Check that the metadata response names this workload. The Hub verifies the Google signature.
  const claims = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
  if (claims.sub !== SERVICE_SUBJECT || claims.email !== SERVICE_EMAIL || claims.email_verified !== true ||
      claims.aud !== AUDIENCE || claims.iss !== "https://accounts.google.com" ||
      !Number.isSafeInteger(claims.exp) || claims.exp <= Date.now() / 1000) throw new Error("Service identity unavailable.");
  return token;
}

/** Authenticated preview read. Configuration, credentials and upstream responses stay on this server. */
export async function handleBeveragePreviewOplocGet(request: PreviewRequest, deps: PreviewOplocDeps = { env: process.env, fetch }) {
  const url = new URL(request.url);
  const oplocIds = configuredPreviewOplocIds(deps.env);
  if (request.method !== "GET" || url.origin !== `https://${BEVERAGE_PREVIEW_HOST}` ||
      url.pathname !== BEVERAGE_PREVIEW_OPLOC_PATH || !oplocIds) return refuse(404, "BEVERAGE_OPLOC_READ_DISABLED");
  if (url.search) return refuse(400, "BEVERAGE_OPLOC_REQUEST_INVALID");
  const origin = request.headers.get("origin");
  const site = request.headers.get("sec-fetch-site");
  if ((origin && origin !== url.origin) || (site && site !== "same-origin" && site !== "none")) {
    return refuse(403, "BEVERAGE_OPLOC_REQUEST_DENIED");
  }

  const cookieName = beveragePreviewCookieName(deps.env);
  const cookie = request.cookies.get(cookieName)?.value;
  if (!cookie || cookie.length > 8192 || !JWT.test(cookie)) return refuse(401, "BEVERAGE_OPLOC_SESSION_REQUIRED");
  const access = await checkBeveragePreviewAccess(deps.env, cookie, deps.verifyPreviewCookie);
  if (access !== "allow") return refuse(access === "invalid" ? 401 : 403, "BEVERAGE_OPLOC_REQUEST_DENIED");

  try {
    const token = await serviceIdentityToken(deps.fetch);
    const target = new URL(`${AUDIENCE}/oplocs`);
    for (const id of oplocIds) target.searchParams.append("oploc", id);
    const response = await deps.fetch(target, {
      method: "GET", headers: { Authorization: `Bearer ${token}`, Cookie: `${cookieName}=${cookie}`, Accept: "application/json" },
      cache: "no-store", redirect: "error", signal: AbortSignal.timeout(5000),
    });
    if (!response.redirected && (response.status === 401 || response.status === 403)) return refuse(response.status, "BEVERAGE_OPLOC_REQUEST_DENIED");
    if (!response.ok || response.redirected || response.headers.get("content-type")?.split(";")[0] !== "application/json") {
      return refuse(503, "BEVERAGE_OPLOC_UNAVAILABLE");
    }
    const result = responseSchema.parse(JSON.parse(await boundedText(response, 64 * 1024)));
    const returnedIds = new Set(result.oplocs.map(item => item.id));
    if (result.oplocs.length !== oplocIds.length || oplocIds.some(id => !returnedIds.has(id))) return refuse(503, "BEVERAGE_OPLOC_UNAVAILABLE");
    return Response.json(result, { headers });
  } catch { return refuse(503, "BEVERAGE_OPLOC_UNAVAILABLE"); }
}
