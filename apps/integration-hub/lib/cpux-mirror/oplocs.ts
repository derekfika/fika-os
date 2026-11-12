import { retrieveReadPackage } from "@fika/server-shared/read-package";
import { OPLOC_MANIFEST_KEY, oplocPackageStore, validateOplocReadPackage, type OplocReadPackage } from "../oploc-read-package";
import { readCacheManifest } from "../integration-cache-server";

/** Read the current verified package only. A preview must not repair or publish it. */
async function readMirrorOplocIndex() {
  const result = await retrieveReadPackage<OplocReadPackage>(oplocPackageStore(), OPLOC_MANIFEST_KEY);
  const manifest = await readCacheManifest("oplocs");
  if (!result || result.manifest.sourceVersion !== "canonical-oplocs:" + manifest.version)
    throw new Error("The authoritative OPLOC package is unavailable or stale.");
  const value = validateOplocReadPackage(result.value);
  return { redirects: value.redirects, byId: new Map(value.oplocs.map(row => [row.canonicalId, row])) };
}

export type MirrorOplocInspection =
  | { sourceId: string; status: "verified"; canonicalId: string; label: string; address: string | null }
  | { sourceId: string; status: "unresolved" };

/** Inspect bounded identities independently so one malformed or orphaned ID does not hide its siblings. */
export async function inspectMirrorOplocs(ids: readonly string[]): Promise<MirrorOplocInspection[]> {
  let index: Awaited<ReturnType<typeof readMirrorOplocIndex>>;
  try { index = await readMirrorOplocIndex(); }
  catch { return ids.map(sourceId => ({ sourceId, status: "unresolved" })); }
  return ids.map(sourceId => {
    let id = sourceId;
    const visited = new Set<string>();
    while (Object.hasOwn(index.redirects, id)) {
      if (visited.has(id) || visited.size >= 16) return { sourceId, status: "unresolved" };
      visited.add(id);
      id = index.redirects[id];
    }
    const record = index.byId.get(id);
    if (!record) return { sourceId, status: "unresolved" };
    return { sourceId, status: "verified", canonicalId: record.canonicalId, label: record.label, address: record.address || null };
  });
}

export async function resolveMirrorOplocs(ids: readonly string[]) {
  const inspected = await inspectMirrorOplocs(ids);
  const unresolved = inspected.find(row => row.status !== "verified");
  if (unresolved) throw new Error("The destination does not resolve to an active canonical OPLOC.");
  return inspected.map(row => {
    if (row.status !== "verified") throw new Error("The destination does not resolve to an active canonical OPLOC.");
    return { sourceId: row.sourceId, canonicalId: row.canonicalId, label: row.label, address: row.address };
  });
}
