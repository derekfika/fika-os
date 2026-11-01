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
export interface FsQuery { get(): Promise<{ docs: FsSnap[] }> }
export interface FsCollection extends FsQuery { doc(id?: string): FsRef & { get(): Promise<FsSnap> }; where(field: string, op: "==", value: unknown): FsQuery; orderBy(field: string, dir: "desc" | "asc"): { limit(n: number): FsQuery } }
export interface FsTransaction { get(target: unknown): Promise<FsSnap & { docs: FsSnap[] }>; set(ref: unknown, data: unknown, options?: { mergeFields: string[] }): void; create(ref: unknown, data: unknown): void }
export interface FsDatabase { collection(name: string): FsCollection; runTransaction<T>(fn: (tx: FsTransaction) => Promise<T>): Promise<T> }

async function defaultDb(): Promise<FsDatabase> { return (await import("../firebase-admin")).db as unknown as FsDatabase; }

const strip = (state: IssueMarks): IssueMarks => ({ issueNumber: state.issueNumber, version: state.version, slots: state.slots, ...(state.updatedAt ? { updatedAt: state.updatedAt } : {}) });

export function createFirestoreMarksStore(getDb: () => Promise<FsDatabase> = defaultDb): MarksStore {
  async function aggregateFromDocs(docs: FsSnap[]): Promise<Record<string, IssueMarks>> {
    const byIssue: Record<string, IssueMarks> = {};
    for (const d of docs) { const s = d.data() as IssueMarks | undefined; if (s && typeof s.issueNumber === "number") byIssue[String(s.issueNumber)] = strip(s); }
    return byIssue;
  }
  return {
    async readAll() {
      const db = await getDb(); const col = db.collection(MARKS_COLLECTION);
      const agg = await col.doc(AGGREGATE_ID).get();
      if (agg.exists) return (agg.data()?.byIssue as Record<string, IssueMarks>) || {};
      // MISSING BUT REBUILDABLE: rebuild once from the authoritative per-issue documents, inside a transaction so a concurrent mark is not lost.
      return db.runTransaction(async tx => {
        const aggRef = col.doc(AGGREGATE_ID);
        const [again, all] = await Promise.all([tx.get(aggRef), tx.get(col.where("docType", "==", "issue-marks"))]);
        if (again.exists) return (again.data()?.byIssue as Record<string, IssueMarks>) || {};
        const byIssue = await aggregateFromDocs(all.docs);
        tx.set(aggRef, { byIssue, rebuiltAt: new Date().toISOString() });
        return byIssue;
      });
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
      const auditRef = db.collection(AUDIT_COLLECTION).doc();
      return db.runTransaction(async tx => {
        const [issueSnap, eventSnap, aggSnap] = await Promise.all([tx.get(issueRef), tx.get(eventRef), tx.get(aggRef)]);
        const result = applyMark(issueSnap.exists ? (issueSnap.data() as unknown as IssueMarks) : undefined, eventSnap.exists ? (eventSnap.data() as unknown as MarkEvent) : undefined, command, ctx);
        if (result.replayed) return result;
        // An absent aggregate must be rebuilt, not started from this one issue.
        const others = aggSnap.exists ? undefined : await aggregateFromDocs((await tx.get(col.where("docType", "==", "issue-marks"))).docs);
        tx.set(issueRef, { ...strip(result.state), docType: "issue-marks" });
        tx.create(eventRef, result.event);
        tx.set(auditRef, auditRecordFor(result.event));
        if (aggSnap.exists) tx.set(aggRef, { byIssue: { [String(command.issueNumber)]: strip(result.state) } }, { mergeFields: [`byIssue.${command.issueNumber}`] });
        else tx.set(aggRef, { byIssue: { ...others, [String(command.issueNumber)]: strip(result.state) }, rebuiltAt: ctx.now.toISOString() });
        return result;
      });
    },
  };
}
