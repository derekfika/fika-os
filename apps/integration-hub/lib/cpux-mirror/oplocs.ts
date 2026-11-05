import { retrieveReadPackage } from "@fika/server-shared/read-package";
import { OPLOC_MANIFEST_KEY, oplocPackageStore, validateOplocReadPackage, type OplocReadPackage } from "../oploc-read-package";
import { readCacheManifest } from "../integration-cache-server";

/** Read the current verified package only. A preview must not repair or publish it. */
export async function resolveMirrorOplocs(ids: readonly string[]) {
  const result = await retrieveReadPackage<OplocReadPackage>(oplocPackageStore(), OPLOC_MANIFEST_KEY);
  const manifest = await readCacheManifest("oplocs");
  if (!result || result.manifest.sourceVersion !== "canonical-oplocs:" + manifest.version)
    throw new Error("The authoritative OPLOC package is unavailable or stale.");
  const value = validateOplocReadPackage(result.value);
  const byId = new Map(value.oplocs.map(row => [row.canonicalId, row]));
  return ids.map(sourceId => {
    let id = sourceId;
    const visited = new Set<string>();
    while (Object.hasOwn(value.redirects, id)) {
      if (visited.has(id) || visited.size >= 16) throw new Error("An OPLOC redirect is invalid.");
      visited.add(id);
      id = value.redirects[id];
    }
    const record = byId.get(id);
    if (!record) throw new Error("The destination does not resolve to an active canonical OPLOC.");
    return { sourceId, canonicalId: record.canonicalId, label: record.label, address: record.address || null };
  });
}
