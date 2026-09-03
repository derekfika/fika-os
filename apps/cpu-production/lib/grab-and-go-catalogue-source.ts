function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

/** Convert the human-approved legacy input envelope in memory only. */
export function normalizeGrabAndGoCatalogueSource(value: unknown): unknown {
  if (isRecord(value) && value.schemaVersion === undefined && value.version === 1) return { schemaVersion: 1, products: value.products };
  return value;
}
