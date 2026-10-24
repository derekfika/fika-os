import type { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { approvedCredentialedUpstream } from "@fika/server-shared/credentialed-upstream";
import { AD_HOC_HUB_API, AD_HOC_SERVICE_TOKEN_HEADER, type AdHocAccess, type AdHocCancelCommand, type AdHocCancelResult, type AdHocOrderStatus, type AdHocSendCommand, type AdHocSendResult, type HubErrorBody } from "../../shared/ad-hoc-production-contract";

// The Integration Hub is the authority for Production Orders, amendments,
// lifecycle transitions and destination authority. Ad-Hoc reaches it only over
// authenticated HTTP: the caller's own session cookie (identity, AUTHMOD scope)
// plus this service's shared token (privileged operations). Both are attached
// server-side; nothing here is ever sent to browser code.

export type HubKind = "unavailable" | "unconfirmed" | "unauthorised" | "forbidden" | "not_found" | "rejected" | "misconfigured" | "invalid_response";
export type HubError = Error & { status: number; kind: HubKind; code?: string };
const hubError = (message: string, status: number, kind: HubKind, code?: string): HubError => Object.assign(new Error(message), { status, kind, ...(code ? { code } : {}) });
export const isHubError = (error: unknown): error is HubError => Boolean(error) && typeof (error as HubError).kind === "string";

type Env = Record<string, string | undefined>;
const TIMEOUT_MS = 10_000;

export function getHubBaseUrl(env: Env = process.env) {
  const mode = env.FIKA_RUNTIME_MODE || (env.NODE_ENV === "production" ? "production" : "local");
  const configured = env.FIKA_HUB_BASE_URL?.trim();
  if (mode === "local") return (configured || "http://localhost:3200").replace(/\/$/, "");
  if (mode !== "staging" && mode !== "production") throw hubError(`Unsupported FIKA_RUNTIME_MODE '${mode}'.`, 503, "misconfigured", "AD_HOC_RUNTIME_MODE");
  if (!configured) throw hubError("FIKA_HUB_BASE_URL is required in the hosted Ad-Hoc Production runtime.", 503, "misconfigured", "AD_HOC_HUB_URL_NOT_CONFIGURED");
  let parsed: URL;
  try { parsed = new URL(configured); } catch { throw hubError("FIKA_HUB_BASE_URL must be a valid HTTPS URL.", 503, "misconfigured", "AD_HOC_HUB_URL_INVALID"); }
  if (parsed.protocol !== "https:") throw hubError("FIKA_HUB_BASE_URL must use HTTPS in the hosted Ad-Hoc Production runtime.", 503, "misconfigured", "AD_HOC_HUB_URL_INVALID");
  return approvedCredentialedUpstream("hub", configured, mode);
}

/** The shared service token is mandatory in hosted runtimes; local development may run without it. */
export function getServiceToken(env: Env = process.env) {
  const token = env.FIKA_INTERNAL_API_TOKEN?.trim();
  const mode = env.FIKA_RUNTIME_MODE || (env.NODE_ENV === "production" ? "production" : "local");
  if (!token && mode !== "local") throw hubError("FIKA_INTERNAL_API_TOKEN is required in the hosted Ad-Hoc Production runtime.", 503, "misconfigured", "AD_HOC_SERVICE_TOKEN_MISSING");
  return token;
}

/** What the service layer needs from the Hub. Tests substitute this port; production uses the HTTP client below. */
export type HubPort = {
  access(options?: { oplocs?: boolean }): Promise<AdHocAccess>;
  send(command: AdHocSendCommand): Promise<AdHocSendResult>;
  cancel(command: AdHocCancelCommand): Promise<AdHocCancelResult>;
  status(requestId: string): Promise<AdHocOrderStatus | null>;
};

type ClientOptions = { cookie?: string; requestId?: string; env?: Env; fetchImpl?: typeof fetch };

export function createHubClient(options: ClientOptions = {}): HubPort {
  const env = options.env || process.env;
  const requestId = options.requestId || randomUUID();
  const doFetch = options.fetchImpl || fetch;

  async function call<T>(path: string, init: { method: "GET" | "POST"; body?: unknown }, mutating: boolean, valid: (value: unknown) => value is T): Promise<{ status: number; value?: T }> {
    const token = getServiceToken(env);
    const base = getHubBaseUrl(env);
    let response: Response;
    try {
      response = await doFetch(`${base}${path}`, {
        method: init.method, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { accept: "application/json", "x-request-id": requestId, ...(init.body ? { "content-type": "application/json" } : {}), ...(options.cookie ? { cookie: options.cookie } : {}), ...(token ? { [AD_HOC_SERVICE_TOKEN_HEADER]: token } : {}) },
        ...(init.body ? { body: JSON.stringify(init.body) } : {}),
      });
    } catch (cause) {
      // A mutating call that failed in flight may still have committed. Say so, and rely on the
      // Hub's idempotency (stable order identity + per-version key) when the requester retries.
      const timeout = cause instanceof DOMException && cause.name === "TimeoutError";
      throw hubError(mutating ? `The Integration Hub did not confirm the change${timeout ? " in time" : ""}. It is safe to try again.` : `The Integration Hub is ${timeout ? "slow to respond" : "unavailable"}.`, 503, mutating ? "unconfirmed" : "unavailable", timeout ? "AD_HOC_HUB_TIMEOUT" : "AD_HOC_HUB_NETWORK_FAILURE");
    }
    const text = await response.text();
    let body: unknown;
    try { body = text ? JSON.parse(text) : undefined; } catch { body = undefined; }
    if (!response.ok) {
      const failure = (body as HubErrorBody | undefined)?.error;
      const message = failure?.message || `The Integration Hub returned HTTP ${response.status}.`;
      if (response.status === 404) return { status: 404 };
      if (response.status === 401) throw hubError(message, 401, "unauthorised", failure?.code);
      if (response.status === 403) throw hubError(message, 403, "forbidden", failure?.code);
      if (response.status >= 500) throw hubError(mutating ? `${message} The change may not have been applied; it is safe to try again.` : message, 503, mutating ? "unconfirmed" : "unavailable", failure?.code);
      throw hubError(message, response.status, "rejected", failure?.code);
    }
    if (!valid(body)) throw hubError("The Integration Hub returned an unexpected response.", 502, "invalid_response", "AD_HOC_HUB_INVALID_RESPONSE");
    return { status: response.status, value: body };
  }

  const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
  const isAccess = (value: unknown): value is AdHocAccess => isObject(value) && isObject(value.principal) && typeof value.principal.id === "string" && (value.oplocs === undefined || Array.isArray(value.oplocs));
  const isSend = (value: unknown): value is AdHocSendResult => isObject(value) && typeof value.canonicalId === "string" && typeof value.orderVersion === "number" && typeof value.outcome === "string" && isObject(value.destination);
  const isCancel = (value: unknown): value is AdHocCancelResult => isObject(value) && typeof value.canonicalId === "string" && typeof value.outcome === "string";
  const isStatus = (value: unknown): value is AdHocOrderStatus => isObject(value) && typeof value.canonicalId === "string" && typeof value.cancelled === "boolean";
  const required = <T>(result: { value?: T }, what: string) => { if (!result.value) throw hubError(`The Integration Hub has no ${what}.`, 404, "not_found", "AD_HOC_ORDER_NOT_FOUND"); return result.value; };

  return {
    access: async options => required(await call(`${AD_HOC_HUB_API.access}${options?.oplocs ? "?oplocs=true" : ""}`, { method: "GET" }, false, isAccess), "access record for you"),
    send: async command => required(await call(AD_HOC_HUB_API.orders, { method: "POST", body: command }, true, isSend), "result for this send"),
    cancel: async command => required(await call(AD_HOC_HUB_API.orders, { method: "POST", body: command }, true, isCancel), "Production Order for this request"),
    status: async requestId => (await call(`${AD_HOC_HUB_API.orders}?requestId=${encodeURIComponent(requestId)}`, { method: "GET" }, false, isStatus)).value ?? null,
  };
}

/** Per-request Hub client carrying the caller's own session cookie. */
export const hubFor = (req: Pick<NextRequest, "headers">) => createHubClient({ cookie: req.headers.get("cookie") || undefined, requestId: req.headers.get("x-request-id") || undefined });

export type Caller = { hub: HubPort; actor: { uid: string; name?: string }; access: AdHocAccess };

/**
 * Admits the caller through the Hub: identity and AUTHMOD scope come from the
 * Hub, never from this app. There is no local or synthetic identity here; local
 * development relies on the Hub's own (local-only) service identity. OPLOC
 * destinations are fetched only when an operation needs them.
 */
export async function callerFor(req: Pick<NextRequest, "headers">, options: { oplocs?: boolean } = {}): Promise<Caller> {
  const hub = hubFor(req);
  const access = await hub.access(options);
  return { hub, access, actor: { uid: access.principal.id, ...(access.principal.displayName ? { name: access.principal.displayName } : {}) } };
}
