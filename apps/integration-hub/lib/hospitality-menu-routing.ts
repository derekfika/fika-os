import { adaptCpuProductionWorkstreams, type CpuProductionWorkstream } from "../../shared/production-workstreams";

type Document = Record<string, unknown> | undefined;
type RoutingReader = { routing(id: string): Promise<Document>; merge(id: string): Promise<Document> };

/** Resolve only requested identities and their merge chains; invalid chains never expose old decisions. */
export async function resolveHospitalityRouting(ids: string[], reader: RoutingReader, fallback: Record<string, CpuProductionWorkstream[]>) {
  const routes = new Map<string, Promise<Document>>();
  const merges = new Map<string, Promise<Document>>();
  const cached = (cache: Map<string, Promise<Document>>, id: string, read: (id: string) => Promise<Document>) => {
    if (!cache.has(id)) cache.set(id, read(id));
    return cache.get(id)!;
  };
  const result: Record<string, CpuProductionWorkstream[]> = {};
  await Promise.all([...new Set(ids)].map(async original => {
    let id = original;
    const seen = new Set<string>();
    for (let hop = 0; hop < 32; hop++) {
      if (seen.has(id)) return;
      seen.add(id);
      const merge = await cached(merges, id, reader.merge);
      if (merge) {
        if (merge.sourceMenuItemId !== id || typeof merge.survivorMenuItemId !== "string" || !merge.survivorMenuItemId.trim()) return;
        id = merge.survivorMenuItemId;
        continue;
      }
      const data = await cached(routes, id, reader.routing);
      if (data?.supersededBy) return;
      if (!data) {
        if (fallback[id]) result[original] = fallback[id];
        return;
      }
      const adapted = adaptCpuProductionWorkstreams(Array.isArray(data.workstreams) ? data.workstreams : Array.isArray(data.views) ? data.views : []);
      if (adapted.unknown.length) throw new Error(`Unknown CPU production workstream value in ${id}: ${adapted.unknown.join(", ")}.`);
      result[original] = adapted.workstreams;
      return;
    }
  }));
  return result;
}
