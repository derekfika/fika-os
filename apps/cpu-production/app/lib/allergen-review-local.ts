import type { OperationalAllergenState } from "../../../shared/allergen-contract";

export type AllergenReviewLineage = {
  productionOrderId: string;
  serviceDate: string;
  sourceDayId: string;
  sourcePublicationId?: string;
  sourcePublicationDayId: string;
  sourceVersion: number;
  sourceContentHash: string;
  matrixContentHash: string;
};

export type AllergenReviewDraft = {
  states: Record<string, Record<string, OperationalAllergenState>>;
  checkedRows: string[];
  lineageByOrderId: Record<string, AllergenReviewLineage>;
  savedAt: string;
};

const memory = new Map<string, string[]>();
const draftMemory = new Map<string, AllergenReviewDraft>();
const DATABASE = "fika-cpu-allergen-review";
const VERSION = 2;

function storageKey(scope: string) { return `cpu-allergen-review:${scope}`; }

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains("checklists")) database.createObjectStore("checklists");
      if (!database.objectStoreNames.contains("drafts")) database.createObjectStore("drafts");
    };
    request.onerror = () => reject(request.error || new Error("CPU allergen review storage could not be opened."));
    request.onsuccess = () => resolve(request.result);
  });
}

export async function loadLocalDraft(scope: string): Promise<AllergenReviewDraft | undefined> {
  if (typeof indexedDB === "undefined") return draftMemory.get(scope);
  try {
    const db = await openDatabase();
    return await new Promise(resolve => {
      const read = db.transaction("drafts", "readonly").objectStore("drafts").get(storageKey(scope));
      read.onerror = () => resolve(draftMemory.get(scope));
      read.onsuccess = () => {
        const draft = read.result as AllergenReviewDraft | undefined;
        if (draft && typeof draft === "object" && draft.states && draft.lineageByOrderId && Array.isArray(draft.checkedRows)) draftMemory.set(scope, draft);
        resolve(draft);
      };
    });
  } catch {
    return draftMemory.get(scope);
  }
}

export async function saveLocalDraft(scope: string, draft: AllergenReviewDraft): Promise<void> {
  draftMemory.set(scope, draft);
  if (typeof indexedDB === "undefined") return;
  try {
    const db = await openDatabase();
    await new Promise<void>(resolve => {
      const write = db.transaction("drafts", "readwrite").objectStore("drafts").put(draft, storageKey(scope));
      write.onerror = () => resolve();
      write.onsuccess = () => resolve();
    });
  } catch {
    // Memory persistence still protects the active page when IndexedDB is unavailable.
  }
}

export async function clearLocalDraft(scope: string): Promise<void> {
  draftMemory.delete(scope);
  if (typeof indexedDB === "undefined") return;
  try {
    const db = await openDatabase();
    await new Promise<void>(resolve => {
      const remove = db.transaction("drafts", "readwrite").objectStore("drafts").delete(storageKey(scope));
      remove.onerror = () => resolve();
      remove.onsuccess = () => resolve();
    });
  } catch {
    // A completed server checkpoint remains authoritative even if draft cleanup fails.
  }
}

export async function loadLocalChecked(scope: string): Promise<Set<string>> {
  if (typeof indexedDB === "undefined") return new Set(memory.get(scope) || []);
  try {
    const db = await openDatabase();
    return await new Promise(resolve => {
      const read = db.transaction("checklists", "readonly").objectStore("checklists").get(storageKey(scope));
      read.onerror = () => resolve(new Set(memory.get(scope) || []));
      read.onsuccess = () => resolve(new Set(Array.isArray(read.result) ? read.result : []));
    });
  } catch {
    return new Set(memory.get(scope) || []);
  }
}

export async function saveLocalChecked(scope: string, checked: Set<string>): Promise<void> {
  const values = [...checked];
  memory.set(scope, values);
  if (typeof indexedDB === "undefined") return;
  try {
    const db = await openDatabase();
    await new Promise<void>(resolve => {
      const write = db.transaction("checklists", "readwrite").objectStore("checklists").put(values, storageKey(scope));
      write.onerror = () => resolve();
      write.onsuccess = () => resolve();
    });
  } catch {
    // The in-memory copy remains available for the current review session.
  }
}
