import { Firestore } from "@google-cloud/firestore";
import { assertPlainData } from "./memory-store";
import { AlreadyExistsError, MAX_BATCH_OPERATIONS, type BatchOp, type CutoverStore, type CutoverTx, type Data, type StoredDoc } from "./store";

/**
 * Firestore adapter (Admin-side, server only). It is NEVER constructed by default: the CLI builds it only after
 * guards.ts has approved the project/environment, and the emulator is selected through FIRESTORE_EMULATOR_HOST.
 * Documents containing non-plain values (e.g. Timestamps) are refused on read so an archive can never silently
 * lose type information.
 */
export function createFirestoreStore(projectId: string): CutoverStore {
  const db = new Firestore({ projectId, ignoreUndefinedProperties: false });
  const read = (path: string, data: Data | undefined) => data ? assertPlainData(data, path) : undefined;
  return {
    kind: "firestore",
    project: projectId,
    async get(path) { const snapshot = await db.doc(path).get(); return snapshot.exists ? read(path, snapshot.data() as Data) : undefined; },
    async getMany(paths) {
      const out: Array<Data | undefined> = [];
      for (let start = 0; start < paths.length; start += 100) {
        const refs = paths.slice(start, start + 100).map(path => db.doc(path));
        const snapshots = await db.getAll(...refs);
        snapshots.forEach((snapshot, index) => out.push(snapshot.exists ? read(refs[index].path, snapshot.data() as Data) : undefined));
      }
      return out;
    },
    async list(collection): Promise<StoredDoc[]> {
      const snapshot = await db.collection(collection).get();
      return snapshot.docs.map(document => ({ id: document.id, data: read(document.ref.path, document.data() as Data)! }));
    },
    async writeBatch(ops: BatchOp[]) {
      if (ops.length > MAX_BATCH_OPERATIONS) throw new Error("Batch exceeds 500 operations");
      const batch = db.batch();
      for (const op of ops) {
        const data = assertPlainData(op.data, op.path);
        if (op.op === "create") batch.create(db.doc(op.path), data); else batch.set(db.doc(op.path), data);
      }
      try { await batch.commit(); } catch (error) {
        if ((error as { code?: number }).code === 6) throw new AlreadyExistsError("batch");
        throw error;
      }
    },
    async runTransaction<T>(fn: (tx: CutoverTx) => Promise<T>) {
      return db.runTransaction(async transaction => {
        const writes: Array<[string, Data]> = [];
        const result = await fn({
          async get(path) { const snapshot = await transaction.get(db.doc(path)); return snapshot.exists ? read(path, snapshot.data() as Data) : undefined; },
          async list(collection) { const snapshot = await transaction.get(db.collection(collection)); return snapshot.docs.map(document => ({ id: document.id, data: read(document.ref.path, document.data() as Data)! })); },
          set(path, data) { writes.push([path, assertPlainData(data, path)]); },
        });
        // Firestore requires every read before any write; buffering the writes guarantees that ordering.
        for (const [path, data] of writes) transaction.set(db.doc(path), data);
        return result;
      });
    },
  };
}
