import { randomUUID } from "node:crypto";
import type { CanonicalBooking } from "./hospitality-booking-service";
import type { QuoteCommercialSnapshot } from "./quote-engine";
import { assertWorkflowCommand } from "./booking-workflow";
import { groupCommercialState, groupError, groupHash } from "./hospitality-group-commercial";
import type { GroupMoneyTotals, GroupQuoteStatus } from "../../shared/hospitality-group-quotes";

export type GroupQuoteHead = { bookingGroupId: string; version: number; latestQuoteId: string; currentQuoteId?: string };
export type HospitalityGroupQuote = {
  schemaVersion: "fika.hospitality-group-quote.v1"; id: string; bookingGroupId: string; revision: number;
  sourceHash: string; childBookingIds: string[]; childVersions: number[]; childCommercialVersions: number[];
  status: GroupQuoteStatus; createdAt: string; updatedAt: string; createdBy: string;
  /** Immutable once prepared. Child sections use the existing quote-engine snapshot contract. */
  snapshots: QuoteCommercialSnapshot[]; totals: GroupMoneyTotals;
  artifact: { fileId?: string; driveUrl?: string; pdfMd5?: string; folderId: string; oplocId: string };
  attempts: number; lease?: { token: string; expiresAt: string }; error?: string;
};
export interface GroupQuoteTransaction {
  children(id: string): Promise<CanonicalBooking[]>;
  head(id: string): Promise<GroupQuoteHead | undefined>;
  quote(id: string): Promise<HospitalityGroupQuote | undefined>;
  putHead(head: GroupQuoteHead): void;
  putQuote(quote: HospitalityGroupQuote): void;
  putChild(booking: CanonicalBooking): void;
  audit(id: string, event: Record<string, unknown>): void;
}
export interface GroupQuoteStore { transaction<T>(run: (tx: GroupQuoteTransaction) => Promise<T>): Promise<T> }
export interface GroupQuoteArtifact {
  reserve(oplocId: string): Promise<string>;
  ensure(quote: HospitalityGroupQuote, persistDigest?: (md5: string) => Promise<void>): Promise<{ fileId: string; driveUrl: string }>;
}
export type GroupQuoteCommand = { bookingGroupId: string; expectedVersion: number; expectedSourceHash: string };
type Context = {
  actorId: string; store: GroupQuoteStore; artifact: GroupQuoteArtifact;
  authorize(children: CanonicalBooking[]): Promise<void>;
  target(booking: CanonicalBooking): Promise<{ folderId: string; oplocId: string }>;
  now?: () => Date;
};
const LEASE_MS = 180_000;

/** One durable group intent, one pre-reserved Drive ID, and one atomic child readiness transition. No CPU/notification side effects. */
export async function generateHospitalityGroupQuote(command: GroupQuoteCommand, context: Context) {
  const now = () => (context.now?.() || new Date()).toISOString();
  const recordAudit = (tx: GroupQuoteTransaction, q: HospitalityGroupQuote, action: string) => tx.audit(`${q.id}:${action}:${q.attempts}`, { action, at: now(), actorId: context.actorId, bookingGroupId: q.bookingGroupId, quoteId: q.id, revision: q.revision, status: q.status, attempt: q.attempts, sourceHash: q.sourceHash, childBookingIds: q.childBookingIds, childCommercialVersions: q.childCommercialVersions });
  const prepared = await context.store.transaction(async tx => {
    const children = await tx.children(command.bookingGroupId);
    const commercial = groupCommercialState(command.bookingGroupId, children);
    await context.authorize(commercial.ordered);
    if (commercial.sourceHash !== command.expectedSourceHash) throw groupError("Group commercial details changed. Refresh before generating the quote.");
    const head = await tx.head(command.bookingGroupId);
    const id = `group-quote:${groupHash(command.bookingGroupId)}:${commercial.sourceHash}`;
    const existing = await tx.quote(id);
    if (existing) return existing;
    if ((head?.version || 0) !== command.expectedVersion) throw groupError("The group quote version changed. Refresh before generating a new revision.");
    for (const child of children) assertWorkflowCommand(child, { action: "quote" });
    const target = await context.target(commercial.ordered[0]);
    if (!target.folderId || !target.oplocId) throw groupError("Configure the location's quote Drive folder before generating a group quote.", 422);
    const q: HospitalityGroupQuote = { schemaVersion: "fika.hospitality-group-quote.v1", id, bookingGroupId: command.bookingGroupId, revision: (head?.version || 0) + 1, sourceHash: commercial.sourceHash,
      childBookingIds: commercial.ordered.map(c => c.canonicalId), childVersions: commercial.ordered.map(c => c.version), childCommercialVersions: commercial.ordered.map(c => c.commercialVersion || 1),
      snapshots: commercial.snapshots, totals: commercial.totals, status: "artifact_pending", createdAt: now(), updatedAt: now(), createdBy: context.actorId, artifact: target, attempts: 0 };
    tx.putQuote(q);
    tx.putHead({ bookingGroupId: q.bookingGroupId, version: q.revision, latestQuoteId: id, ...(head?.currentQuoteId ? { currentQuoteId: head.currentQuoteId } : {}) });
    recordAudit(tx, q, "group-quote-prepared");
    return q;
  });
  if (["complete", "superseded", "integrity_failed"].includes(prepared.status)) return prepared;
  const token = randomUUID();
  const claimed = await context.store.transaction(async tx => {
    const q = (await tx.quote(prepared.id))!;
    if (["complete", "superseded", "integrity_failed"].includes(q.status) || (q.lease && q.lease.expiresAt > now())) return undefined;
    const next: HospitalityGroupQuote = { ...q, status: "artifact_pending", attempts: q.attempts + 1, updatedAt: now(), lease: { token, expiresAt: new Date(Date.parse(now()) + LEASE_MS).toISOString() } };
    delete next.error;
    tx.putQuote(next); recordAudit(tx, next, "group-quote-artifact-claimed");
    return next;
  });
  if (!claimed) return context.store.transaction(async tx => (await tx.quote(prepared.id))!);
  try {
    let q = claimed;
    const frozenHash = groupHash(q.snapshots.map((snapshot, i) => ({ snapshot, commercialVersion: q.childCommercialVersions[i], cancelled: false })));
    const frozenTotals = Object.fromEntries(Object.keys(q.totals).map(key => [key, Math.round(q.snapshots.reduce((sum, snapshot) => sum + snapshot.totals[key as keyof GroupMoneyTotals].amount, 0) * 100) / 100]));
    if (frozenHash !== q.sourceHash || groupHash(frozenTotals) !== groupHash(q.totals) || q.snapshots.some((snapshot, i) => snapshot.bookingId !== q.childBookingIds[i])) throw Object.assign(new Error("The frozen group quote snapshot failed integrity verification."), { integrityFailed: true });
    if (!q.artifact.fileId) {
      const fileId = await context.artifact.reserve(q.artifact.oplocId);
      q = await context.store.transaction(async tx => {
        const stored = (await tx.quote(q.id))!;
        if (stored.lease?.token !== token) throw groupError("Another quote recovery is in progress. Refresh the group.");
        // The ID is durable BEFORE the first Drive file write. A lost upload response is recoverable by direct ID.
        const next = { ...stored, artifact: { ...stored.artifact, fileId: stored.artifact.fileId || fileId }, updatedAt: now() };
        tx.putQuote(next); return next;
      });
    }
    const artifact = await context.artifact.ensure(q, async pdfMd5 => {
      await context.store.transaction(async tx => {
        const stored = (await tx.quote(q.id))!;
        if (stored.lease?.token !== token) throw groupError("Another quote recovery is in progress. Refresh the group.");
        tx.putQuote({ ...stored, artifact: { ...stored.artifact, pdfMd5 }, updatedAt: now() });
      });
    });
    if (artifact.fileId !== q.artifact.fileId) throw groupError("Group quote artifact identity failed verification.", 422);
    return await context.store.transaction(async tx => {
      const stored = (await tx.quote(q.id))!;
      const children = await tx.children(stored.bookingGroupId);
      const head = await tx.head(stored.bookingGroupId);
      if (stored.status === "complete") return stored;
      if (stored.lease?.token !== token) return stored;
      const commercial = groupCommercialState(stored.bookingGroupId, children);
      await context.authorize(commercial.ordered);
      if (head?.latestQuoteId !== stored.id || commercial.sourceHash !== stored.sourceHash) {
        const obsolete: HospitalityGroupQuote = { ...stored, status: "superseded", artifact: { ...stored.artifact, ...artifact }, updatedAt: now() };
        delete obsolete.lease;
        tx.putQuote(obsolete); recordAudit(tx, obsolete, "group-quote-superseded"); return obsolete;
      }
      for (const child of commercial.ordered) assertWorkflowCommand(child, { action: "quote" });
      // Same governed QuoteRevision shape/readiness guards as single bookings. Sections share ONE customer document.
      commercial.ordered.forEach((child, i) => {
        const revisions = child.quoteState?.revisions || [];
        const sectionId = `${stored.id}:service:${child.bookingGroup!.sequence}`;
        const at = now(); const reason = `Consolidated group quote ${stored.id} saved to Drive.`;
        const next: CanonicalBooking = { ...child, version: child.version + 1, updatedAt: at, updatedBy: context.actorId,
          lifecycleStatus: ["Completed", "Sent to CPU"].includes(child.lifecycleStatus) ? child.lifecycleStatus : "Quoted",
          order: { ...child.order, netTotal: stored.snapshots[i].totals.net.amount, vatTotal: stored.snapshots[i].totals.vat.amount, grossTotal: stored.snapshots[i].totals.gross.amount },
          quoteState: { currentRevisionId: sectionId, revisions: [...revisions.map(r => ({ ...r, stale: true })), { id: sectionId, revision: revisions.length + 1, createdAt: stored.createdAt, createdBy: stored.createdBy, commercialVersion: child.commercialVersion || 1, snapshot: stored.snapshots[i], documentReference: stored.id, groupQuoteId: stored.id, stale: false, pdfStatus: "saved", driveFileId: artifact.fileId, driveUrl: artifact.driveUrl }] },
          statusHistory: [...child.statusHistory, { status: ["Completed", "Sent to CPU"].includes(child.lifecycleStatus) ? child.lifecycleStatus : "Quoted", changedAt: at, changedBy: context.actorId, reason }],
          audit: [...child.audit, { action: "workflow-group-quote", at, by: context.actorId, reason }],
        };
        tx.putChild(next);
      });
      const complete: HospitalityGroupQuote = { ...stored, status: "complete", artifact: { ...stored.artifact, ...artifact }, updatedAt: now() };
      delete complete.lease; delete complete.error;
      tx.putQuote(complete); tx.putHead({ ...head!, currentQuoteId: stored.id });
      recordAudit(tx, complete, "group-quote-completed");
      return complete;
    });
  } catch (error) {
    // Includes upload success followed by a failed final DB commit. Preserve the reserved file ID and frozen snapshot for replay.
    return context.store.transaction(async tx => {
      const q = (await tx.quote(claimed.id))!;
      if (q.status === "complete" || q.lease?.token !== token) return q;
      const integrityFailed = Boolean((error as { integrityFailed?: boolean })?.integrityFailed);
      const failed: HospitalityGroupQuote = { ...q, status: integrityFailed ? "integrity_failed" : "failed", updatedAt: now(), error: integrityFailed ? "The saved group quote failed verification. Ask an administrator to inspect the artifact before continuing." : "The group quote could not be completed. Retry this quote to resume safely." };
      delete failed.lease;
      tx.putQuote(failed); recordAudit(tx, failed, "group-quote-failed");
      console.error("hospitality.group-quote.failed", { quoteId: q.id, attempt: q.attempts, message: error instanceof Error ? error.message : String(error) });
      return failed;
    });
  }
}
