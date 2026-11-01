/** Minimal Firestore-shaped surface. The same cutover code runs on the in-memory fake, the emulator and (later, behind guards) a real project. */
export type Data = Record<string, unknown>;
export type StoredDoc = { id: string; data: Data };
export type BatchOp = { op: "create" | "set"; path: string; data: Data };

export interface CutoverTx {
  get(path: string): Promise<Data | undefined>;
  /** Whole-collection read; deliberate administrative scan only. */
  list(collection: string): Promise<StoredDoc[]>;
  /** Full-document replace (never a merge) so the result is exactly the data given. */
  set(path: string, data: Data): void;
}

export interface CutoverStore {
  readonly kind: "memory" | "firestore";
  readonly project?: string;
  get(path: string): Promise<Data | undefined>;
  getMany(paths: string[]): Promise<Array<Data | undefined>>;
  list(collection: string): Promise<StoredDoc[]>;
  /** Atomic, at most 500 operations. `create` fails with AlreadyExistsError and then nothing is written. */
  writeBatch(ops: BatchOp[]): Promise<void>;
  /** Optimistic transaction: reads are validated at commit and the callback is retried on contention. */
  runTransaction<T>(fn: (tx: CutoverTx) => Promise<T>): Promise<T>;
}

export class AlreadyExistsError extends Error {
  constructor(readonly path: string) { super(`Document already exists: ${path}`); this.name = "AlreadyExistsError"; }
}
/** Thrown (never retried) when the catalogue changed under the cutover. The journal stays resumable. */
export class ConcurrentCatalogueChangeError extends Error {
  constructor(message: string) { super(message); this.name = "ConcurrentCatalogueChangeError"; }
}
export const MAX_BATCH_OPERATIONS = 500;

export const COLLECTIONS = {
  catalogue: "fikaMenuPlanningCatalogue",
  manifests: "fikaMenuPlanningCatalogueManifests",
  archives: "fikaMenuPlanningCatalogueArchives",
  journals: "fikaMenuPlanningCatalogueCutovers",
} as const;
export const MANIFEST_PATH = `${COLLECTIONS.manifests}/catalogue`;
export const archivePath = (cutoverId: string) => `${COLLECTIONS.archives}/${cutoverId}`;
export const journalPath = (cutoverId: string) => `${COLLECTIONS.journals}/${cutoverId}`;
