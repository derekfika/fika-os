import { createHash } from "node:crypto";
import { readExplicitAllergens, type StoredRowReview } from "./allergen-declaration";

/**
 * FEAT-034 row-scoped save: pure merge and concurrency rules for saving ONE allergen row instead of the whole day.
 * Not wired into any route yet; CPU adopts it behind a new `save-row` action (see docs/ai/FEAT-034-allergen-design.md section 5).
 */
export type StoredAllergenRow = { rowId: string; identity: string; allergens: Record<string, unknown>; mayContainNotes?: string; review?: StoredRowReview | null; lastRequestId?: string };
export type RowSaveRequest = { rowId: string; clientRequestId: string; expectedRowRevision: string; next: Omit<StoredAllergenRow, "rowId" | "lastRequestId"> };
export type RowSaveResult =
  | { ok: true; replay: boolean; row: StoredAllergenRow; revision: string }
  | { ok: false; reason: "conflict"; current: StoredAllergenRow; revision: string }
  | { ok: false; reason: "invalid"; message: string };

const ORDER = (a: [string, unknown], b: [string, unknown]) => a[0].localeCompare(b[0]);

/** Revision of one stored row: changes whenever any reviewed or displayed value changes. A missing row has the revision "new". */
export function rowRevision(row: StoredAllergenRow | undefined | null): string {
  if (!row) return "new";
  const allergens = Object.entries(readExplicitAllergens(row.allergens)).sort(ORDER);
  const review = row.review ? [row.review.semantics ?? null, row.review.status ?? null, row.review.confirmedBy ?? null, row.review.confirmedAt ?? null, row.review.inputFingerprint ?? null] : null;
  return createHash("sha256").update(JSON.stringify([row.rowId, row.identity, allergens, row.mayContainNotes ?? "", review])).digest("hex").slice(0, 16);
}

/**
 * Applies one row save against the row currently stored. Only that row changes, so two chefs on different rows never conflict.
 * A stale revision returns the current row for the client to reapply; a retry of an already applied request is an idempotent replay.
 */
export function applyRowSave(current: StoredAllergenRow | undefined, request: RowSaveRequest): RowSaveResult {
  if (!request.rowId?.trim() || !request.clientRequestId?.trim()) return { ok: false, reason: "invalid", message: "rowId and clientRequestId are required." };
  if (!request.next.identity?.trim()) return { ok: false, reason: "invalid", message: "A named dish or row is required." };
  if (current && current.lastRequestId === request.clientRequestId) return { ok: true, replay: true, row: current, revision: rowRevision(current) };
  const revision = rowRevision(current);
  if (request.expectedRowRevision !== revision) return { ok: false, reason: "conflict", current: current as StoredAllergenRow, revision };
  const row: StoredAllergenRow = { ...request.next, rowId: request.rowId, lastRequestId: request.clientRequestId };
  return { ok: true, replay: false, row, revision: rowRevision(row) };
}

/** Rapid edits to the same row collapse to the newest one; order across different rows is preserved. */
export function coalesceRowEdits<T extends { rowId: string }>(pending: T[]): T[] {
  const latest = new Map<string, T>();
  for (const edit of pending) { latest.delete(edit.rowId); latest.set(edit.rowId, edit); }
  return [...latest.values()];
}

export type RowSaveState = "unchecked" | "saving" | "saved" | "failed";
/** Signing and release stay disabled until every row is Saved. */
export const canSignAllergenDay = (states: RowSaveState[]) => states.every((state) => state === "saved" || state === "unchecked");
