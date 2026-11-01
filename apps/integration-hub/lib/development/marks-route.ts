// Owner-marks HTTP handlers (#241). Dependencies are injected so every guard is testable without Firebase.
import { NextResponse } from "next/server";
import { errorResponse } from "../api";
import { HISTORY_LIMIT, MarkCommandSchema, MarkError, MAX_BODY_BYTES, type MarksStore } from "./marks";
import { snapshotTrusted, verifiedStagingSha } from "./marks-shared";
import type { DevelopmentSnapshot } from "./types";

/** What the handler needs from the AUTHMOD admin context. The actor is derived ONLY from here, never from the request. */
export interface OwnerContext { actor?: { uid?: string; name?: string }; principal?: { id?: string; displayName?: string } }
export interface MarksRouteDeps {
  authorize: (request: Request) => Promise<unknown>;
  assertSameOrigin: (request: Request) => void;
  service: { get(options: { refresh?: boolean }): Promise<DevelopmentSnapshot> };
  marks: MarksStore;
  rateLimiter: { allow(key: string): boolean };
  now?: () => Date;
}

const NO_STORE = { "Cache-Control": "no-store" };
function fail(status: number, code: string, message: string, extra: Record<string, unknown> = {}) {
  const requestId = crypto.randomUUID();
  return NextResponse.json({ error: { code, message, requestId, ...extra } }, { status, headers: { ...NO_STORE, "x-request-id": requestId } });
}

async function admit(request: Request, deps: Pick<MarksRouteDeps, "authorize">): Promise<{ context: OwnerContext } | { response: Response }> {
  try { return { context: (await deps.authorize(request)) as OwnerContext }; }
  catch (error) {
    const status = (error as { status?: number }).status;
    return { response: errorResponse(status === 401 || status === 403 ? error : Object.assign(new Error("Access denied."), { status: 403, code: "DEVELOPMENT_ACCESS_DENIED" })) };
  }
}

/** Identity comes from the server-side AUTHMOD context; if it is incomplete the request is refused (fail closed). */
function actorOf(context: OwnerContext): { id: string; uid: string; name: string } | undefined {
  const id = context?.principal?.id; const uid = context?.actor?.uid;
  const name = context?.principal?.displayName || context?.actor?.name;
  return id && uid && name ? { id, uid, name } : undefined;
}

/** Streams the body and stops as soon as the cap is exceeded, whether or not Content-Length was sent or truthful. */
async function readCapped(request: Request, max: number): Promise<string> {
  if (!request.body) return "";
  const reader = request.body.getReader(); const chunks: Uint8Array[] = []; let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) { void reader.cancel().catch(() => undefined); throw new MarkError(413, "DEVELOPMENT_BODY_TOO_LARGE", "That request is too large."); }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function handleMarksPost(request: Request, deps: MarksRouteDeps) {
  const admitted = await admit(request, deps);
  if ("response" in admitted) return admitted.response;
  const actor = actorOf(admitted.context);
  if (!actor) return fail(403, "DEVELOPMENT_ACTOR_UNRESOLVED", "Your identity could not be confirmed for this action.");
  try { deps.assertSameOrigin(request); } catch { return fail(403, "DEVELOPMENT_ORIGIN_DENIED", "Request origin is not allowed."); }
  if (!/^application\/json(\s*;|$)/i.test(request.headers.get("content-type") || "")) return fail(415, "DEVELOPMENT_JSON_REQUIRED", "Send the request as JSON.");
  if (!deps.rateLimiter.allow(actor.id)) return fail(429, "DEVELOPMENT_RATE_LIMITED", "Too many mark changes. Wait a minute and try again.");

  if (Number(request.headers.get("content-length") || 0) > MAX_BODY_BYTES) return fail(413, "DEVELOPMENT_BODY_TOO_LARGE", "That request is too large.");
  let text: string;
  try { text = await readCapped(request, MAX_BODY_BYTES); } catch (error) { return error instanceof MarkError ? fail(error.status, error.code, error.message) : fail(400, "DEVELOPMENT_BAD_BODY", "The request could not be read."); }
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return fail(400, "DEVELOPMENT_BAD_JSON", "The request was not valid JSON."); }
  const parsed = MarkCommandSchema.safeParse(raw);
  if (!parsed.success) return fail(422, "DEVELOPMENT_MARK_INVALID", "That mark is not valid. Check the fields and try again.", { fields: [...new Set(parsed.error.issues.map(i => String(i.path[0] ?? "request")))].slice(0, 6) });
  const command = parsed.data;

  try {
    // The issue must exist in the verified snapshot, and the serving build (if any) is resolved by the server, never the client.
    const snapshot = await deps.service.get({});
    const issue = snapshot.issues.find(i => i.number === command.issueNumber);
    if (!issue) return fail(snapshot.issues.length ? 404 : 503, snapshot.issues.length ? "DEVELOPMENT_ISSUE_UNKNOWN" : "DEVELOPMENT_SNAPSHOT_UNAVAILABLE", snapshot.issues.length ? "That issue is not in the dashboard." : "Issue data is unavailable, so the issue cannot be confirmed. Try again shortly.");
    const result = await deps.marks.append(command, { actorId: actor.id, actorUid: actor.uid, actorName: actor.name, now: (deps.now || (() => new Date()))(), verifiedStagingSha: snapshotTrusted(snapshot) ? verifiedStagingSha(issue) : undefined });
    return NextResponse.json({ replayed: result.replayed, event: result.event, state: result.state }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof MarkError) return fail(error.status, error.code, error.message, error.extra);
    console.error("Development mark failed", { code: "DEVELOPMENT_MARK_FAILED" });
    return fail(500, "DEVELOPMENT_MARK_FAILED", "The mark could not be saved. Nothing was recorded; try again.");
  }
}

export async function handleMarksHistoryGet(request: Request, deps: Pick<MarksRouteDeps, "authorize" | "marks">) {
  const admitted = await admit(request, deps);
  if ("response" in admitted) return admitted.response;
  const raw = new URL(request.url).searchParams.get("issue") || "";
  const issueNumber = /^\d{1,7}$/.test(raw) ? Number(raw) : 0;
  if (issueNumber < 1) return fail(422, "DEVELOPMENT_MARK_INVALID", "An issue number is required.");
  try { return NextResponse.json({ issueNumber, events: await deps.marks.history(issueNumber, HISTORY_LIMIT) }, { headers: NO_STORE }); }
  catch { return fail(502, "DEVELOPMENT_HISTORY_FAILED", "Mark history could not be loaded."); }
}
