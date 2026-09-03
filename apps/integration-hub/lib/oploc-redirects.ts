import type { CanonicalRecord } from "./types";

type OplocRecord = Pick<CanonicalRecord, "entityType" | "canonicalId" | "record">;
type OplocAlias = { sourceReference?: unknown };

/** Builds Hub-owned historical-id redirects from immutable OPLOC records. */
export function buildOplocRedirects(records: readonly OplocRecord[]) {
  const byId = new Map(records.filter(record => record.entityType === "OPLOC" && record.canonicalId).map(record => [record.canonicalId, record]));
  const links = new Map<string, string>();
  for (const record of byId.values()) {
    const successor = record.record.lifecycleState === "merged" ? String(record.record.mergedIntoOplocId || "") : "";
    if (successor) links.set(record.canonicalId, successor);
    const aliases = Array.isArray(record.record.aliases) ? record.record.aliases as OplocAlias[] : [];
    for (const alias of aliases) {
      const sourceReference = typeof alias.sourceReference === "string" ? alias.sourceReference.trim() : "";
      if (sourceReference && sourceReference !== record.canonicalId) {
        const existing = links.get(sourceReference);
        if (existing && existing !== record.canonicalId) throw new Error(`The OPLOC alias ${sourceReference} points to multiple canonical records.`);
        links.set(sourceReference, record.canonicalId);
      }
    }
  }
  const redirects: Record<string, string> = {};
  for (const start of links.keys()) {
    let current = start;
    const visited = new Set<string>();
    while (true) {
      if (visited.has(current)) throw new Error(`The OPLOC redirect chain contains a cycle at ${current}.`);
      visited.add(current);
      const successor = links.get(current) || "";
      if (!successor) break;
      current = successor;
    }
    if (current !== start) redirects[start] = current;
  }
  return redirects;
}

export function legacyOplocIds(redirects: Readonly<Record<string, string>>, canonicalId: string) {
  return Object.entries(redirects).filter(([, target]) => target === canonicalId).map(([legacyId]) => legacyId).sort();
}
