import type {
  CatalogueCommand,
  CatalogueCommandResult,
  CataloguePayload,
  CatalogueRow,
  CatalogueServiceLayout,
} from "./catalogue-wire";

export class CatalogueCommandError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

function plainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function wireRow(value: unknown): value is CatalogueRow {
  return (
    plainObject(value) &&
    typeof value.itemId === "string" &&
    Number.isSafeInteger(value.version) &&
    typeof value.name === "string" &&
    typeof value.category === "string" &&
    (value.status === "active" || value.status === "archived") &&
    plainObject(value.routing) &&
    Number.isSafeInteger(value.routing.version) &&
    typeof value.routing.state === "string" &&
    Array.isArray(value.offerings) &&
    Array.isArray(value.availableAt) &&
    Array.isArray(value.needsReview)
  );
}

function serviceScope(value: unknown): boolean {
  return (
    plainObject(value) &&
    Number.isSafeInteger(value.version) &&
    plainObject(value.services)
  );
}

function storedServices(
  value: unknown,
): value is Pick<CatalogueServiceLayout, "company" | "sites"> {
  return (
    plainObject(value) &&
    serviceScope(value.company) &&
    plainObject(value.sites) &&
    Object.values(value.sites).every(serviceScope)
  );
}

export function isCataloguePayload(value: unknown): value is CataloguePayload {
  return (
    plainObject(value) &&
    typeof value.canManage === "boolean" &&
    Array.isArray(value.rows) &&
    value.rows.every(wireRow) &&
    Array.isArray(value.oplocs) &&
    Array.isArray(value.reviewGroups) &&
    plainObject(value.counts) &&
    plainObject(value.canonicalisation) &&
    (value.serviceLayout === undefined ||
      (storedServices(value.serviceLayout) &&
        plainObject(
          (value.serviceLayout as Record<string, unknown>).vocabulary,
        )))
  );
}

function validBulkResult(value: unknown) {
  return (
    plainObject(value) &&
    typeof value.operationId === "string" &&
    Number.isSafeInteger(value.succeeded) &&
    Number.isSafeInteger(value.failed) &&
    typeof value.message === "string" &&
    Array.isArray(value.results) &&
    value.results.every(
      (result) =>
        plainObject(result) &&
        typeof result.status === "string" &&
        typeof result.message === "string",
    )
  );
}

export function catalogueReceipt(
  value: unknown,
  command: CatalogueCommand,
): CatalogueCommandResult | null {
  if (
    !plainObject(value) ||
    typeof value.message !== "string" ||
    (value.package !== "published" &&
      value.package !== "unchanged" &&
      value.package !== "stale")
  )
    return null;
  if (value.payload !== undefined && !isCataloguePayload(value.payload))
    return null;
  if (
    value.rows !== undefined &&
    !(Array.isArray(value.rows) && value.rows.every(wireRow))
  )
    return null;
  if (
    value.serviceLayoutStored !== undefined &&
    !storedServices(value.serviceLayoutStored)
  )
    return null;
  if (command.action === "bulk-update" || command.action === "bulk-create") {
    const result =
      command.action === "bulk-update" ? value.bulk : value.bulkCreate;
    if (
      !validBulkResult(result) ||
      !plainObject(result) ||
      result.operationId !== command.operationId ||
      !Array.isArray(value.rows)
    )
      return null;
  } else if (
    command.action === "set-service-categories" ||
    command.action === "clear-service-override"
  ) {
    const stored = value.serviceLayoutStored;
    if (!storedServices(stored) || typeof command.expectedVersion !== "number")
      return null;
    const scope =
      typeof command.oplocId === "string"
        ? stored.sites[command.oplocId]
        : stored.company;
    if (!scope || scope.version <= command.expectedVersion) return null;
  } else if (
    !value.payload &&
    !(Array.isArray(value.rows) && value.rows.length)
  ) {
    return null;
  }
  if (
    typeof command.itemId === "string" &&
    Array.isArray(value.rows) &&
    !value.rows.some((row) => wireRow(row) && row.itemId === command.itemId)
  )
    return null;
  return value as CatalogueCommandResult;
}

export async function requestCatalogueCommand(
  command: CatalogueCommand,
  request: typeof fetch = fetch,
): Promise<CatalogueCommandResult> {
  let response: Response;
  try {
    response = await request("/api/catalogue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify(command),
    });
  } catch {
    throw new CatalogueCommandError(
      "Hub did not confirm this change. The outcome is unknown.",
    );
  }
  const body: unknown = await response.json().catch(() => null);
  if ([400, 401, 403, 409, 413, 415, 422].includes(response.status)) {
    const message = plainObject(body) ? body.error : undefined;
    const wording =
      response.status === 401 || response.status === 403
        ? "Your session needs current Hub catalogue management access."
        : typeof message === "string" && message.length <= 500
          ? message
          : "Hub declined this change. Check the details before trying again.";
    throw new CatalogueCommandError(wording, response.status);
  }
  const receipt = response.ok && catalogueReceipt(body, command);
  if (!receipt)
    throw new CatalogueCommandError(
      "Hub did not confirm this change. The outcome is unknown.",
    );
  return receipt;
}

function mergeRow(current: CatalogueRow, patch: CatalogueRow): CatalogueRow {
  const item = patch.version >= current.version ? patch : current;
  const routing =
    patch.routing.version >= current.routing.version
      ? patch.routing
      : current.routing;
  return item.routing === routing ? item : { ...item, routing };
}

export function applyCatalogueReceipt(
  data: CataloguePayload,
  receipt: CatalogueCommandResult,
): CataloguePayload {
  if (receipt.payload) return receipt.payload;
  const rowsById = new Map(data.rows.map((row) => [row.itemId, row]));
  for (const patch of receipt.rows ?? []) {
    const previous = rowsById.get(patch.itemId);
    rowsById.set(patch.itemId, previous ? mergeRow(previous, patch) : patch);
  }
  const rows = [...rowsById.values()].sort(
    (a, b) =>
      a.name.localeCompare(b.name, "en-GB") || a.itemId.localeCompare(b.itemId),
  );
  const active = rows.filter((row) => row.status === "active");
  let serviceLayout = data.serviceLayout;
  if (serviceLayout) {
    const stored = receipt.serviceLayoutStored;
    const sites = { ...serviceLayout.sites };
    for (const [siteId, scope] of Object.entries(stored?.sites ?? {})) {
      if (scope.version >= (sites[siteId]?.version ?? 0)) sites[siteId] = scope;
    }
    serviceLayout = {
      company:
        stored && stored.company.version >= serviceLayout.company.version
          ? stored.company
          : serviceLayout.company,
      sites,
      vocabulary: {
        ...serviceLayout.vocabulary,
        catalogueCategories: [
          ...new Set(active.map((row) => row.category)),
        ].sort((a, b) => a.localeCompare(b, "en-GB")),
      },
    };
  }
  return {
    ...data,
    rows,
    ...(serviceLayout && { serviceLayout }),
    counts: {
      active: active.length,
      archived: rows.length - active.length,
      needsReview: active.filter((row) => row.needsReview.length).length,
      routingRequired: active.filter(
        (row) => row.routing.state === "routing_required",
      ).length,
    },
  };
}
