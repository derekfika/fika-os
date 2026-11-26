import {
  currentDataTrace, recordDataAccess, setDataTraceOutcome, withDataTrace,
} from "@fika/server-shared/data-source-meter-server";

const app = "hospitality-menu-studio";

export function studioPageTrace<T>(callback: () => Promise<T>) {
  return withDataTrace({ app, action: "open", path: "/" }, callback);
}

export function studioRouteTrace<RequestType extends Request>(path: string, handler: (request: RequestType) => Promise<Response>) {
  return (request: RequestType) =>
    withDataTrace({ app, action: request.method, path }, async () => {
      const response = await handler(request);
      setDataTraceOutcome(response.ok ? "SUCCESS" : response.status === 401 || response.status === 403
        ? "DENIED" : response.status === 404 ? "NOT_FOUND" : "ERROR");
      return response;
    });
}

export function studioUpstreamHeaders(): Record<string, string> {
  const trace = currentDataTrace();
  return trace ? { "x-fika-data-request-id": trace.traceId } : {};
}

export async function studioUpstream(operation: string, request: () => Promise<Response>) {
  const started = Date.now();
  try {
    const response = await request();
    recordDataAccess({ operation, source: "NETWORK_UPSTREAM", documents: 0,
      outcome: response.ok ? "SUCCESS" : "ERROR", durationMs: Date.now() - started });
    return response;
  } catch (error) {
    recordDataAccess({ operation, source: "NETWORK_UPSTREAM", documents: 0, outcome: "ERROR", durationMs: Date.now() - started });
    throw error;
  }
}

export function studioFirestoreRead(operation: string, kind: "query" | "document" | "transaction", returned: number, attempted?: number) {
  const dataset = operation.startsWith("product-menu.") ? "studio.product-menu-drafts"
    : operation.startsWith("product-publication.") ? "studio.product-menu-publications"
    : operation.startsWith("legacy.dish-") || operation.startsWith("legacy.dishes.") || operation.startsWith("legacy.assigned-dish-")
      ? "studio.legacy-dish-drafts" : "studio.legacy-menu-drafts";
  recordDataAccess({ operation, source: "FIRESTORE", documents: returned, firestoreReadKind: kind,
    dataset, estimatedBillableReads: attempted ?? Math.max(1, returned) });
}

export async function readStudioDocument<T extends { exists: boolean }>(operation: string, input: Promise<T>, transactional = false) {
  const result = await input;
  studioFirestoreRead(operation, transactional ? "transaction" : "document", Number(result.exists), 1);
  return result;
}

export async function readStudioDocuments<T extends { exists: boolean }>(operation: string, input: Promise<T[]>, transactional = false) {
  const result = await input;
  studioFirestoreRead(operation, transactional ? "transaction" : "document", result.filter(document => document.exists).length, result.length);
  return result;
}

export async function readStudioQuery<T extends { size: number }>(operation: string, input: Promise<T>) {
  const result = await input;
  studioFirestoreRead(operation, "query", result.size);
  return result;
}
