const memory = new Map<string, string[]>();

function storageKey(scope: string) { return `cpu-allergen-review:${scope}`; }

export async function loadLocalChecked(scope: string): Promise<Set<string>> {
  if (typeof indexedDB === "undefined") return new Set(memory.get(scope) || []);
  return new Promise(resolve => {
    const request = indexedDB.open("fika-cpu-allergen-review", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("checklists");
    request.onerror = () => resolve(new Set(memory.get(scope) || []));
    request.onsuccess = () => {
      const db = request.result;
      const read = db.transaction("checklists", "readonly").objectStore("checklists").get(storageKey(scope));
      read.onerror = () => resolve(new Set(memory.get(scope) || []));
      read.onsuccess = () => resolve(new Set(Array.isArray(read.result) ? read.result : []));
    };
  });
}

export async function saveLocalChecked(scope: string, checked: Set<string>): Promise<void> {
  const values = [...checked];
  memory.set(scope, values);
  if (typeof indexedDB === "undefined") return;
  await new Promise<void>(resolve => {
    const request = indexedDB.open("fika-cpu-allergen-review", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("checklists");
    request.onerror = () => resolve();
    request.onsuccess = () => {
      const db = request.result;
      const write = db.transaction("checklists", "readwrite").objectStore("checklists").put(values, storageKey(scope));
      write.onerror = () => resolve();
      write.onsuccess = () => resolve();
    };
  });
}
