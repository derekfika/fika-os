import { AlreadyExistsError, MAX_BATCH_OPERATIONS, type BatchOp, type CutoverStore, type CutoverTx, type Data, type StoredDoc } from "./store";

type Entry = { data: Data; version: number };
const parentOf = (path: string) => path.slice(0, path.lastIndexOf("/"));
const idOf = (path: string) => path.slice(path.lastIndexOf("/") + 1);

/** Firestore rejects `undefined` field values unless configured otherwise; the fake does too so code cannot rely on silent stripping. */
function plain(value: unknown, where: string): unknown {
  if (value === undefined) throw new Error(`Firestore rejects undefined at ${where}`);
  if (value === null || typeof value !== "object") {
    if (typeof value === "number" && !Number.isFinite(value)) throw new Error(`Non-finite number at ${where}`);
    return value;
  }
  if (Array.isArray(value)) return value.map((item, index) => plain(item, `${where}[${index}]`));
  if (Object.getPrototypeOf(value) !== Object.prototype) throw new Error(`Non-plain object at ${where}`);
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, plain(item, `${where}.${key}`)]));
}
const clone = (data: Data, where: string) => plain(data, where) as Data;
/** Fail-closed guard shared with the Firestore adapter: only plain JSON documents can be archived/restored byte-faithfully. */
export const assertPlainData = clone;

/**
 * In-memory Firestore stand-in with the semantics the cutover relies on: per-document versions, atomic
 * batches, create-if-absent, and optimistic transactions that retry (ABORTED) when any document or listing
 * they read changed before commit. `beforeCommit` lets tests inject a concurrent writer deterministically.
 */
export class MemoryStore implements CutoverStore {
  readonly kind = "memory" as const;
  private docs = new Map<string, Entry>();
  private clock = 0;
  /** Test hook: runs after the transaction callback and before commit validation. */
  beforeCommit?: (attempt: number) => void | Promise<void>;
  /** Test hook: when set, the commit after this many successful commits throws, simulating a crash. */
  crashAfterCommits?: number;
  commits = 0;
  readonly maxAttempts = 5;
  constructor(readonly project = "demo-fika-cutover") {}

  private tick() { return ++this.clock; }
  private commitGate() {
    if (this.crashAfterCommits !== undefined && this.commits >= this.crashAfterCommits) throw new Error("simulated crash before commit");
    this.commits++;
  }
  /** Direct seeding / out-of-band mutation (bypasses hooks and counters). */
  seed(path: string, data: Data) { this.docs.set(path, { data: clone(data, path), version: this.tick() }); }
  peek(path: string) { const entry = this.docs.get(path); return entry ? structuredClone(entry.data) : undefined; }
  paths(collection?: string) { return [...this.docs.keys()].filter(path => collection === undefined || parentOf(path) === collection).sort(); }
  exportAll() { return Object.fromEntries([...this.docs.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([path, entry]) => [path, structuredClone(entry.data)])); }

  async get(path: string) { const entry = this.docs.get(path); return entry ? structuredClone(entry.data) : undefined; }
  async getMany(paths: string[]) { return Promise.all(paths.map(path => this.get(path))); }
  async list(collection: string): Promise<StoredDoc[]> { return this.paths(collection).map(path => ({ id: idOf(path), data: structuredClone(this.docs.get(path)!.data) })); }

  async writeBatch(ops: BatchOp[]) {
    if (ops.length > MAX_BATCH_OPERATIONS) throw new Error("Batch exceeds 500 operations");
    const seen = new Set<string>();
    for (const op of ops) {
      if (seen.has(op.path)) throw new Error(`Duplicate path in batch: ${op.path}`);
      seen.add(op.path);
      if (op.op === "create" && this.docs.has(op.path)) throw new AlreadyExistsError(op.path);
    }
    const prepared = ops.map(op => ({ path: op.path, data: clone(op.data, op.path) }));
    this.commitGate();
    for (const op of prepared) this.docs.set(op.path, { data: op.data, version: this.tick() });
  }

  async runTransaction<T>(fn: (tx: CutoverTx) => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      const readVersions = new Map<string, number>();
      const readLists = new Map<string, string>();
      const writes = new Map<string, Data>();
      let wrote = false;
      const signature = (collection: string) => this.paths(collection).map(path => `${path}@${this.docs.get(path)!.version}`).join("|");
      const tx: CutoverTx = {
        get: async path => {
          if (wrote) throw new Error("Firestore transactions require all reads before writes");
          const entry = this.docs.get(path);
          if (!readVersions.has(path)) readVersions.set(path, entry?.version ?? 0);
          return entry ? structuredClone(entry.data) : undefined;
        },
        list: async collection => {
          if (wrote) throw new Error("Firestore transactions require all reads before writes");
          if (!readLists.has(collection)) readLists.set(collection, signature(collection));
          return this.list(collection);
        },
        set: (path, data) => {
          wrote = true;
          if (writes.size >= MAX_BATCH_OPERATIONS && !writes.has(path)) throw new Error("Transaction exceeds 500 writes");
          writes.set(path, clone(data, path));
        },
      };
      const result = await fn(tx);
      await this.beforeCommit?.(attempt);
      const stale = [...readVersions].some(([path, version]) => (this.docs.get(path)?.version ?? 0) !== version) || [...readLists].some(([collection, sig]) => signature(collection) !== sig);
      if (stale) {
        if (attempt >= this.maxAttempts) throw new Error("Transaction aborted after repeated contention (ABORTED)");
        continue;
      }
      if (writes.size) { this.commitGate(); for (const [path, data] of writes) this.docs.set(path, { data, version: this.tick() }); }
      return result;
    }
  }
}
