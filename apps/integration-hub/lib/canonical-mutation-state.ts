import type { CanonicalRecord } from "./types";

export function canonicalRecordFromMutationResponse(
  payload: unknown,
): CanonicalRecord | null {
  if (!payload || typeof payload !== "object") return null;
  const body = payload as Record<string, unknown>;
  const candidate = isCanonicalRecord(body.record)
    ? body.record
    : body.mutation &&
        typeof body.mutation === "object" &&
        isCanonicalRecord((body.mutation as Record<string, unknown>).record)
      ? (body.mutation as Record<string, unknown>).record
      : null;
  return candidate as CanonicalRecord | null;
}

export function replaceCanonicalRecord(
  records: CanonicalRecord[],
  next: CanonicalRecord,
) {
  return records.map((record) =>
    record.canonicalId === next.canonicalId ? next : record,
  );
}

export function canonicalDisplayStatus(record: CanonicalRecord) {
  const lifecycle =
    record.lifecycleStatus ||
    (record.publicationStatus === "published"
      ? "published"
      : record.publicationStatus === "withdrawn"
        ? "archived"
        : "needs-review");
  return {
    lifecycle,
    approval:
      record.entityType === "Address"
        ? String(record.record.approvalState || "pending")
        : undefined,
    publication:
      lifecycle === "published" && record.publicationStatus === "published"
        ? "published"
        : "unpublished",
  };
}

export function availableLifecycleActions(record: CanonicalRecord) {
  const { lifecycle } = canonicalDisplayStatus(record);
  if (record.entityType === "Address")
    return lifecycle === "published"
      ? ["archive"]
      : lifecycle === "archived"
        ? ["restore"]
        : ["publish-valid-address"];
  if (lifecycle === "draft") return ["send-to-review"];
  if (lifecycle === "needs-review") return ["return-to-draft", "publish"];
  if (lifecycle === "published") return ["archive"];
  return ["restore"];
}

function isCanonicalRecord(value: unknown): value is CanonicalRecord {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<CanonicalRecord>;
  const record = candidate.record as Record<string, unknown> | undefined;
  return (
    typeof candidate.canonicalId === "string" &&
    typeof candidate.entityType === "string" &&
    typeof candidate.dataHash === "string" &&
    Boolean(
      record &&
      Number.isInteger(Number(record.version)) &&
      typeof record.schemaVersion === "string" &&
      typeof record.createdAt === "string" &&
      typeof record.updatedAt === "string",
    )
  );
}
