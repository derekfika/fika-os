// Firestore (Admin SDK, server-side only) store for owner marks (#241). No client SDK, no composite index, no rules change.
//
// Collection `development_dashboard_marks`:
//   issue-{N}              AUTHORITATIVE per-issue state {version, slots}; the concurrency token. docType "issue-marks".
//   issue-{N}/events/{id}  AUTHORITATIVE append-only owner-action history (id derived from the idempotency key; created, never updated).
//   current                DERIVED aggregate {byIssue} so the dashboard reads one document. Rebuildable from the issue-N docs.
// Every write is one transaction: state + event + audit record + aggregate entry. A replay writes nothing.
import { applyMark, auditRecordFor, eventIdFor, HISTORY_LIMIT, type ApplyResult, type MarkCommand, type MarkContext, type MarksStore } from "./marks";
import type { IssueMarks, MarkEvent } from "./marks-shared";

export const MARKS_COLLECTION = "development_dashboard_marks";
export const AUDIT_COLLECTION = "integrationHubGovernanceAudit";
const AGGREGATE_ID = "current";
const issueDocId = (n: number) => `issue-${n}`;

/** The slice of the Firestore Admin API used here, so the store can be exercised against an in-memory fake. */
export interface FsSnap { exists: boolean; data(): Record<string, unknown> | undefined }
export interface FsRef { collection(name: string): FsCollection }
export interface FsQuery { get(): Promise<{ docs: FsSnap[] }>; limit(n: number): FsQuery }
export interface FsCollection extends FsQuery { doc(id?: string): FsRef & { get(): Promise<FsSnap> }; where(field: string, op: "==", value: unknown): FsQuery; orderBy(field: string, dir: "desc" | "asc"): { limit(n: number): FsQuery } }
export interface FsTransaction { get(target: unknown): Promise<FsSnap & { docs: FsSnap[] }>; set(ref: unknown, data: unknown, options?: { mergeFields: string[] }): void; create(ref: unknown, data: unknown): void }
export interface FsDatabase { collection(name: string): FsCollection; runTransaction<T>(fn: (tx: FsTransaction) => Promise<T>): Promise<T> }

async function defaultDb(): Promise<FsDatabase> { return (await import("../firebase-admin")).db as unknown as FsDatabase; }

const AGGREGATE_SCAN_LIMIT = 1000;
/** Authoritative per-issue state, kept whole (notes included). */
const strip = (state: IssueMarks): IssueMarks => ({ issueNumber: state.issueNumber, version: state.version, slots: state.slots, ...(state.updatedAt ? { updatedAt: state.updatedAt } : {}) });
/** Derived aggregate entry: no notes (history holds them) and none at all for an issue with no current marks. */
export function summaryOf(state: IssueMarks): IssueMarks | undefined {
  const slots = Object.fromEntries(Object.entries(state.slots).map(([k, e]) => { const { note, ...rest } = e!; void note; return [k, rest]; })) as IssueMarks["slots"];
  return Object.keys(slots).length ? { issueNumber: state.issueNumber, version: state.version, slots, ...(state.updatedAt ? { updatedAt: state.updatedAt } : {}) } : undefined;
}

async function defaultDelete(): Promise<unknown> { return (await import("firebase-admin/firestore")).FieldValue.delete(); }

export function createFirestoreMarksStore(getDb: () => Promise<FsDatabase> = defaultDb, deleteField: () => Promise<unknown> = defaultDelete): MarksStore {
  async function aggregateFromDocs(docs: FsSnap[]): Promise<Record<string, IssueMarks>> {
    const byIssue: Record<string, IssueMarks> = {};
    for (const d of docs) { const s = d.data() as IssueMarks | undefined; if (!s || typeof s.issueNumber !== "number") continue; const sum = summaryOf(s); if (sum) byIssue[String(s.issueNumber)] = sum; }
    return byIssue;
  }
  return {
    async readAll() {
      const db = await getDb(); const col = db.collection(MARKS_COLLECTION);
      const agg = await col.doc(AGGREGATE_ID).get();
      if (agg.exists) return (agg.data()?.byIssue as Record<string, IssueMarks>) || {};
      // MISSING BUT REBUILDABLE: compute from the authoritative per-issue documents, read-only. A GET never writes; the aggregate is
      // (re)written only inside the next append transaction.
      return aggregateFromDocs((await col.where("docType", "==", "issue-marks").limit(AGGREGATE_SCAN_LIMIT).get()).docs);
    },
    async history(issueNumber, limit = HISTORY_LIMIT) {
      const db = await getDb();
      const snap = await db.collection(MARKS_COLLECTION).doc(issueDocId(issueNumber)).collection("events").orderBy("version", "desc").limit(Math.min(limit, HISTORY_LIMIT)).get();
      return snap.docs.map(d => d.data() as unknown as MarkEvent);
    },
    async append(command: MarkCommand, ctx: MarkContext): Promise<ApplyResult> {
      const db = await getDb(); const col = db.collection(MARKS_COLLECTION);
      const issueRef = col.doc(issueDocId(command.issueNumber)); const aggRef = col.doc(AGGREGATE_ID);
      const eventRef = issueRef.collection("events").doc(eventIdFor(command.issueNumber, command.idempotencyKey));
      const auditRef = db.collection(AUDIT_COLLECTION).doc(`audit_${eventIdFor(command.issueNumber, command.idempotencyKey)}`);
      return db.runTransaction(async tx => {
        const [issueSnap, eventSnap, aggSnap] = await Promise.all([tx.get(issueRef), tx.get(eventRef), tx.get(aggRef)]);
        const result = applyMark(issueSnap.exists ? (issueSnap.data() as unknown as IssueMarks) : undefined, eventSnap.exists ? (eventSnap.data() as unknown as MarkEvent) : undefined, command, ctx);
        if (result.replayed) return result;
        // An absent aggregate must be rebuilt, not started from this one issue.
        const others = aggSnap.exists ? undefined : await aggregateFromDocs((await tx.get(col.where("docType", "==", "issue-marks").limit(AGGREGATE_SCAN_LIMIT))).docs);
        tx.set(issueRef, { ...strip(result.state), docType: "issue-marks" });
        tx.create(eventRef, result.event);
        const summary = summaryOf(result.state);
        const entryValue = summary ?? (await deleteField());
        tx.set(auditRef, auditRecordFor(result.event, ctx.actorUid));
        if (aggSnap.exists) tx.set(aggRef, { byIssue: { [String(command.issueNumber)]: entryValue } }, { mergeFields: [`byIssue.${command.issueNumber}`] });
        else { const rebuilt = { ...others }; delete rebuilt[String(command.issueNumber)]; tx.set(aggRef, { byIssue: { ...rebuilt, ...(summary ? { [String(command.issueNumber)]: summary } : {}) }, rebuiltAt: ctx.now.toISOString() }); }
        return result;
      });
    },
  };
}
