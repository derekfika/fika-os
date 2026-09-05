import type { RollingSnapshot } from "./rolling-menu-types";

export type ImportSessionFile = { name: string; size: number; lastModified: number; type?: string };
export type ImportSession = {
  savedAt: number;
  files: ImportSessionFile[];
  reports: Array<Record<string, unknown>>;
  snapshots: RollingSnapshot[];
  resolutions: Array<Record<string, unknown>>;
  overrides: Record<string, string>;
  conflicts: Array<Record<string, unknown>>;
};

const databaseName = "fika-menu-planning";
const storeName = "importSessions";
const sessionKey = "legacy-week-import";

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(storeName);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Saved import review is unavailable."));
  });
}

export async function saveImportSession(session: ImportSession) {
  if (typeof indexedDB === "undefined") return;
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(storeName, "readwrite");
    transaction.objectStore(storeName).put(session, sessionKey);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("Saved import review could not be updated."));
  });
  database.close();
}

export async function loadImportSession(): Promise<ImportSession | undefined> {
  if (typeof indexedDB === "undefined") return undefined;
  const database = await openDatabase();
  const value = await new Promise<ImportSession | undefined>((resolve, reject) => {
    const transaction = database.transaction(storeName, "readonly");
    const request = transaction.objectStore(storeName).get(sessionKey);
    request.onsuccess = () => resolve(request.result as ImportSession | undefined);
    request.onerror = () => reject(request.error || new Error("Saved import review could not be read."));
  });
  database.close();
  return value;
}

export async function clearImportSession() {
  if (typeof indexedDB === "undefined") return;
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(storeName, "readwrite");
    transaction.objectStore(storeName).delete(sessionKey);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("Saved import review could not be cleared."));
  });
  database.close();
}
