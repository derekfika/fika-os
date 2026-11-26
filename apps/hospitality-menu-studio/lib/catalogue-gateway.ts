import { z } from "zod";
import { resolveHospitalityOffering, deliveryWeekday, type CataloguePackage } from "@fika/server-shared/hospitality-effective-offering";
import { categoryAllowedForService, effectiveServiceLayout, SERVICE_IDS } from "@fika/server-shared/hospitality-service-layout";
import { authoriseStudioRequest, assertStudioRequestHost, requireSameOrigin, studioSessionCookie } from "./auth";
import { compressedCatalogueLimit, publicCataloguePath, readStudioCatalogue, verifiedPublicCatalogueBytes } from "./catalogue";
import { studioUpstream, studioUpstreamHeaders } from "./data-trace";
import { StudioProblem } from "./problem";
import { dateSchema } from "./schema";
import type { studioRuntime } from "./runtime";

const path = "/api/hospitality-catalogue";
const maxCommandBytes = 4 * 1024 * 1024;
const headers = { "Cache-Control": "private, no-store" };
const actions = [
  "adopt-company-default", "bulk-create", "bulk-update", "clear-service-override",
  "create-item", "link-provider-item", "merge-items", "record-review-decision",
  "rename-category", "set-default-price", "set-item-status", "set-routing",
  "set-service-categories", "set-site-availability", "set-site-override", "update-item",
] as const;
const actionSchema = z.object({ action: z.enum(actions) });
const availabilityQuery = z.strictObject({
  itemId: z.string().min(8).max(160),
  siteId: z.string().min(8).max(160),
  serviceId: z.enum(SERVICE_IDS),
  eventDate: dateSchema,
});

type StudioRuntime = ReturnType<typeof studioRuntime>;
type AvailabilityQuery = z.infer<typeof availabilityQuery>;

function problem(status: number, code: string, message: string) {
  return new StudioProblem(status, code, message);
}

function unavailable() {
  return problem(503, "CATALOGUE_UNAVAILABLE", "Hub catalogue information is unavailable. Try again.");
}

function outcomeUnknown() {
  return problem(503, "CATALOGUE_OUTCOME_UNKNOWN",
    "Studio could not confirm the result of this change. Refresh the catalogue and check its current values before trying again.");
}

function forbidden() {
  return problem(403, "CATALOGUE_ACCESS_DENIED", "This account lacks permission for this catalogue action.");
}

async function commandBody(request: Request) {
  if (request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") {
    throw problem(415, "CATALOGUE_JSON_REQUIRED", "Send the catalogue change as JSON.");
  }
  const tooLarge = () => problem(413, "CATALOGUE_COMMAND_TOO_LARGE", "This catalogue change is too large. Split it into smaller batches.");
  if (Number(request.headers.get("content-length")) > maxCommandBytes) throw tooLarge();
  const reader = request.body?.getReader();
  let bytes = 0;
  const chunks: string[] = [];
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const invalid = () => problem(422, "CATALOGUE_COMMAND_INVALID", "Check the catalogue action and try again.");
  if (!reader) throw invalid();
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxCommandBytes) {
        await reader.cancel().catch(() => undefined);
        throw tooLarge();
      }
      chunks.push(decoder.decode(value, { stream: true }));
    }
    chunks.push(decoder.decode());
    const body = chunks.join("");
    if (!actionSchema.safeParse(JSON.parse(body)).success) throw invalid();
    return body;
  } catch (error) {
    throw error instanceof StudioProblem ? error : invalid();
  } finally {
    reader.releaseLock();
  }
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
}

function adminPayload(value: unknown, studioCanManage: boolean) {
  const payload = asObject(value);
  if (!payload || typeof payload.canManage !== "boolean" ||
      !Array.isArray(payload.rows) || !Array.isArray(payload.oplocs) ||
      !Array.isArray(payload.reviewGroups) || typeof payload.generatedAt !== "string" ||
      !asObject(payload.canonicalisation) || !asObject(payload.counts)) throw unavailable();
  return { ...payload, canManage: studioCanManage && payload.canManage };
}

function mutationResult(body: unknown) {
  const result = asObject(body);
  if (!result || typeof result.message !== "string" ||
      (result.package !== "published" && result.package !== "unchanged" && result.package !== "stale") ||
      !(Array.isArray(result.rows) || asObject(result.payload))) throw outcomeUnknown();
  if (!result.payload) return result;
  try {
    return { ...result, payload: adminPayload(result.payload, true) };
  } catch {
    throw outcomeUnknown();
  }
}

async function hubProblem(response: Response, write: boolean) {
  switch (response.status) {
    case 401:
      return problem(401, "FIKA_SESSION_INVALID", "Sign in again to open the catalogue.");
    case 403:
      return forbidden();
    case 409:
      return problem(409, "CATALOGUE_CONFLICT", "The catalogue changed. Refresh it and review the current values before trying again.");
    case 400:
    case 422: {
      const envelope = asObject(await response.json().catch(() => undefined));
      const message = asObject(envelope?.error)?.message;
      const detail = typeof message === "string" && message.length <= 500
        ? message.replace(/booking information/gi, "catalogue information") : "Check the catalogue fields and try again.";
      return problem(response.status, "CATALOGUE_INPUT_REJECTED", detail);
    }
    default:
      return write ? outcomeUnknown() : unavailable();
  }
}

/** Site-level eligibility from the same published item, price and service rules used by Hub. */
export function catalogueEligibility(catalogue: CataloguePackage, { itemId, siteId, serviceId, eventDate }: AvailabilityQuery) {
  const result = resolveHospitalityOffering(catalogue, itemId, siteId, { serviceDate: eventDate });
  if (!result.available) {
    const reason = result.reason === "no_price" || result.reason === "ambiguous_price" || result.reason === "invalid_price"
      ? "A current price could not be verified for this date." : "This product is unavailable at this site.";
    return { status: "unavailable", reason } as const;
  }

  const offering = result.offering;
  if (!categoryAllowedForService(catalogue.serviceLayout ?? effectiveServiceLayout(), siteId, serviceId, offering.category)) {
    return { status: "unavailable", reason: "The selected service does not offer this product category at this site." } as const;
  }
  if (deliveryWeekday(eventDate) === 5 && offering.bookingPolicy?.fridayUnavailable) {
    return { status: "unavailable", reason: "This product is unavailable on Fridays." } as const;
  }
  const { minimumQuantity, minimumGuests, noticeRequiredDays } = offering.constraints;
  const minimums = { minimumQuantity, minimumGuests, noticeRequiredDays };
  if (offering.quoteRequired) return { status: "quote_only", ...minimums } as const;
  if (!offering.price) return { status: "unavailable", reason: "A current price could not be verified for this date." } as const;
  return { status: "standard", amount: offering.price.amount, vatRate: offering.price.vatRate, ...minimums } as const;
}

export function catalogueGateway(
  runtime: StudioRuntime,
  requestHub: typeof fetch = fetch,
) {
  async function decide(request: Request, cookie: string | undefined, action: "read" | "write" | "availability" | "version") {
    try {
      const write = action === "write";
      assertStudioRequestHost(runtime, request.headers.get("host"));
      if (write) requireSameOrigin(request, runtime);
      if (runtime.fixture) throw unavailable();
      const actor = await authoriseStudioRequest(request, cookie, runtime, requestHub);
      if (write && !actor.canManage) throw forbidden();
      const session = studioSessionCookie(runtime, cookie!);

      if (action === "availability") {
        const params = new URL(request.url).searchParams;
        const parsed = availabilityQuery.safeParse(Object.fromEntries(params));
        if (!parsed.success || [...params].length !== 4) {
          throw problem(422, "CATALOGUE_SELECTION_REQUIRED", "Choose a product, site, service and event date.");
        }
        const checked = await readStudioCatalogue(runtime.hub, session, requestHub);
        return Response.json(catalogueEligibility(checked.catalogue, parsed.data), { headers });
      }
      if (new URL(request.url).search) throw problem(422, "CATALOGUE_QUERY_INVALID", "This catalogue request does not accept filters.");
      const body = write ? await commandBody(request) : undefined;
      let response: Response;
      try {
        const version = action === "version";
        response = await studioUpstream(write ? "hub.catalogue.admin-command" : version ? "hub.catalogue.admin-version" : "hub.catalogue.admin-read", () => requestHub(runtime.hub + path + (version ? "/version" : ""), {
          method: write ? "POST" : "GET",
          headers: {
            cookie: session,
            accept: "application/json",
            ...studioUpstreamHeaders(),
            ...(!write && !version ? { "X-Fika-Catalogue-Versioned": "1" } : {}),
            ...(write ? { "content-type": "application/json", origin: runtime.hub } : {}),
          },
          body,
          cache: "no-store",
          redirect: "error",
          signal: AbortSignal.timeout(write ? 55_000 : 12_000),
        }));
      } catch {
        throw write ? outcomeUnknown() : unavailable();
      }
      if (action === "version" && response.status === 404) return new Response(null, { status: 404, headers });
      if (!response.ok) throw await hubProblem(response, write);
      const value: unknown = await response.json().catch(() => undefined);
      if (action === "version") {
        const head = asObject(value);
        if (head?.schemaVersion !== 1 || typeof head.version !== "string" || !head.version.length || head.version.length > 200 || typeof head.canManage !== "boolean") throw unavailable();
        return Response.json({ ...head, canManage: actor.canManage && head.canManage }, { headers });
      }
      const version = response.headers.get("X-Fika-Catalogue-Version");
      return Response.json(write ? mutationResult(value) : adminPayload(value, actor.canManage), {
        headers: { ...headers, ...(version && { "X-Fika-Catalogue-Version": version }) },
      });
    } catch (error) {
      const failure = error instanceof StudioProblem ? error : unavailable();
      return Response.json({ error: { code: failure.code, message: failure.message } }, { status: failure.status, headers });
    }
  }

  return {
    GET: (request: Request, cookie?: string) => decide(request, cookie, "read"),
    POST: (request: Request, cookie?: string) => decide(request, cookie, "write"),
    availability: (request: Request, cookie?: string) => decide(request, cookie, "availability"),
    version: (request: Request, cookie?: string) => decide(request, cookie, "version"),
  };
}

/** Forward only Hub's authenticated public-safe projection, preserving raw gzip bytes. */
export async function publicCatalogueResponse(
  request: Request, cookie: string | undefined, runtime: StudioRuntime, hash?: string, requestHub: typeof fetch = fetch,
) {
  try {
    assertStudioRequestHost(runtime, request.headers.get("host"));
    if (runtime.fixture) throw unavailable();
    await authoriseStudioRequest(request, cookie, runtime, requestHub);
    if (new URL(request.url).search || (hash !== undefined && !/^[0-9a-f]{64}$/.test(hash))) {
      throw problem(422, "CATALOGUE_QUERY_INVALID", "Choose a valid catalogue package.");
    }
    const read = (suffix = "") => studioUpstream(suffix ? "hub.catalogue.public-package" : "hub.catalogue.public-manifest", () =>
      requestHub(runtime.hub + publicCataloguePath + suffix, {
        headers: { cookie: studioSessionCookie(runtime, cookie!), ...studioUpstreamHeaders() },
        cache: "no-store", redirect: "error", signal: AbortSignal.timeout(12_000),
      }));
    const verified = hash && verifiedPublicCatalogueBytes(runtime.hub, hash);
    if (verified) {
      // A server or another browser may have warmed these bytes. Hub still
      // verifies this caller's independent catalogue permission on every use.
      const response = await read();
      if (!response.ok) throw await hubProblem(response, false);
      const manifest = asObject(await response.json());
      if (manifest?.dataset === "hospitality-booking/catalogue" && manifest.contentHash === hash) {
        return new Response(verified, { headers: { ...headers, "Content-Type": "application/octet-stream" } });
      }
    }
    const response = await read(hash ? "/" + hash : "");
    if (!response.ok) throw await hubProblem(response, false);
    if (!hash) return Response.json(await response.json(), { headers });
    if (Number(response.headers.get("content-length")) > compressedCatalogueLimit) throw unavailable();
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > compressedCatalogueLimit) throw unavailable();
    return new Response(bytes, { headers: { ...headers, "Content-Type": "application/octet-stream" } });
  } catch (error) {
    const failure = error instanceof StudioProblem ? error : unavailable();
    return Response.json({ error: { code: failure.code, message: failure.message } }, { status: failure.status, headers });
  }
}
