export type OutboxInventoryOperation =
  | "outbox-page-query"
  | "scheduler-candidate-query"
  | "booking-source-join"
  | "production-order-source-join"
  | "oploc-verification";

export type OutboxInventoryErrorCode =
  | "FIRESTORE_INDEX_REQUIRED"
  | "FIRESTORE_PERMISSION_DENIED"
  | "FIRESTORE_UNAUTHENTICATED"
  | "FIRESTORE_UNAVAILABLE"
  | "FIRESTORE_DEADLINE_EXCEEDED"
  | "FIRESTORE_FAILED_PRECONDITION"
  | "FIRESTORE_READ_FAILED";

/** Carries only a bounded operation name and safe classification, never a raw provider message. */
export class OutboxInventoryReadError extends Error {
  constructor(readonly operation: OutboxInventoryOperation, readonly errorCode: OutboxInventoryErrorCode) {
    super("Calendar outbox inventory read failed.");
    this.name = "OutboxInventoryReadError";
  }
}

function providerCode(error: unknown): string {
  if (!error || typeof error !== "object" || !("code" in error)) return "";
  return String((error as { code?: unknown }).code ?? "").toLowerCase().replaceAll("_", "-");
}

function providerMessage(error: unknown): string {
  if (!error || typeof error !== "object" || !("message" in error)) return "";
  return String((error as { message?: unknown }).message ?? "").toLowerCase();
}

export function classifyOutboxInventoryError(error: unknown): OutboxInventoryErrorCode {
  const code = providerCode(error);
  const message = providerMessage(error);
  if ((code === "9" || code.includes("failed-precondition")) && /index/.test(message)) return "FIRESTORE_INDEX_REQUIRED";
  if (code === "7" || code.includes("permission-denied")) return "FIRESTORE_PERMISSION_DENIED";
  if (code === "16" || code.includes("unauthenticated")) return "FIRESTORE_UNAUTHENTICATED";
  if (code === "14" || code.includes("unavailable")) return "FIRESTORE_UNAVAILABLE";
  if (code === "4" || code.includes("deadline-exceeded")) return "FIRESTORE_DEADLINE_EXCEEDED";
  if (code === "9" || code.includes("failed-precondition")) return "FIRESTORE_FAILED_PRECONDITION";
  return "FIRESTORE_READ_FAILED";
}

export async function outboxInventoryRead<T>(operation: OutboxInventoryOperation, read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (error) {
    throw new OutboxInventoryReadError(operation, classifyOutboxInventoryError(error));
  }
}

export function safeOutboxInventoryDiagnostic(error: unknown) {
  return error instanceof OutboxInventoryReadError
    ? { operation: error.operation, errorCode: error.errorCode }
    : { operation: "inventory-aggregation", errorCode: "INVENTORY_READ_FAILED" as const };
}
