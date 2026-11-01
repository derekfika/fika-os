import type { MenuItem } from "../domain";
import { catalogueSourceHash } from "../catalogue-source";
import type { CutoverInputs, MappingEntry } from "./inputs";
import { digest } from "./digest";
import { MemoryStore } from "./memory-store";
import { COLLECTIONS, MANIFEST_PATH } from "./store";

export const NOW = "2026-11-02T09:00:00.000Z";
export const PRE_REVISION = 160;

export function makeItem(id: string, name: string, extra: Partial<MenuItem> = {}): MenuItem {
  return {
    canonicalId: id, sourceName: name, displayName: name, category: "Salad", yield: 2, portionSize: 1.5, weekId: "menu-week:rolling-import", dayId: "", revision: 2, reviewStatus: "approved",
    sourceReference: { workbook: "rolling menu", sheet: "SALAD 1" }, mayContainReviewed: true,
    allergenEvidence: [{ allergen: "gluten", value: "free_from", source: "Imported", reviewedBy: "chef", reviewedAt: "2026-08-25T15:31:23.599Z" }],
    audit: [{ action: "imported", at: "2026-08-25T15:31:23.599Z", by: "rolling-menu-migration" }],
    ...extra,
  };
}
export const doc = (record: MenuItem) => ({ id: record.canonicalId, kind: "dish", source: "menu-planning-local", schemaVersion: "1.0.0", reconciliationStatus: "unreconciled", record });

export type World = { store: MemoryStore; inputs: CutoverInputs; v1: Map<string, MenuItem>; ids: { keep: string[]; tags: string[]; tests: string[]; mergeFrom: string; mergeTo: string; archived: string[]; rolling: string[]; sandwich: string } };

/** A small but structurally faithful V1: keepers (some gaining tags/subtype), retired tests, one merge, already-archived history, rolling ids and a non-dish document. */
export function makeWorld(options: { project?: string } = {}): World {
  const records: MenuItem[] = [];
  const keep: string[] = [], tags: string[] = [], tests: string[] = [], archived: string[] = [], rolling: string[] = [];
  for (let index = 1; index <= 12; index++) { const id = `menu-item:local:keeper-${index}`; keep.push(id); records.push(makeItem(id, `Keeper ${index}`, { category: index % 3 === 0 ? "Salad" : "Soup" })); }
  for (let index = 1; index <= 3; index++) { const id = `menu-item:rolling:rolling-${index}`; rolling.push(id); keep.push(id); records.push(makeItem(id, `Rolling ${index}`)); }
  const mergeTo = "menu-item:local:tomato-salad";
  const mergeFrom = "menu-item:local:tomato-salad-";
  keep.push(mergeTo);
  records.push(makeItem(mergeTo, "Tomato Salad"), makeItem(mergeFrom, "Tomato Salad"));
  for (let index = 1; index <= 2; index++) { const id = `dish:Test Dish ${index}`; tests.push(id); records.push(makeItem(id, `Test Dish ${index}`)); }
  for (let index = 1; index <= 4; index++) {
    const id = `menu-item:local:old-${index}`; archived.push(id);
    records.push(makeItem(id, `Old ${index}`, { reviewStatus: "archived", ...(index === 1 ? { audit: [{ action: "automatically-merged-into-canonical-dish", at: "2026-01-01T00:00:00.000Z", by: "legacy" }] } : {}) }));
  }
  const v1 = new Map(records.map(record => [record.canonicalId, record]));
  const store = new MemoryStore(options.project ?? "demo-fika-cutover");
  for (const record of records) store.seed(`${COLLECTIONS.catalogue}/${record.canonicalId}`, doc(record));
  const sandwich = "sandwich:chicken-wrap";
  store.seed(`${COLLECTIONS.catalogue}/${sandwich}`, { id: sandwich, kind: "sandwich", record: { id: sandwich, title: "Chicken wrap" } });
  const hash = catalogueSourceHash(records);
  store.seed(MANIFEST_PATH, { schemaVersion: 1, sourceHashVersion: 2, catalogueVersion: PRE_REVISION, sourceRevision: PRE_REVISION, sourceHash: hash, dishCount: records.length, updatedAt: "2026-10-30T10:00:00.000Z", lastMutationBy: "someone", packageState: { status: "current", sourceRevision: PRE_REVISION, sourceHash: hash, requestedAt: "x", updatedAt: "x", packageVersion: 12, packageHash: "p".repeat(64), attempts: 1 }, extraFieldToPreserve: { nested: [1, 2, 3] } });

  const v2Records = new Map<string, MenuItem>();
  keep.forEach((id, index) => {
    const base = v1.get(id)!;
    const tagged = index % 2 === 0;
    if (tagged) tags.push(id);
    v2Records.set(id, tagged ? { ...base, revision: base.revision + 1, tagIds: ["dish-tag:type:vegetable-side"], ...(base.category === "Salad" ? { subcategory: "Veg" } : {}), audit: [...base.audit, { action: "tags-assigned", at: "2026-10-30T22:00:00.000Z", by: "upgrade:dish-library" }] } : structuredClone(base));
  });
  const mappings: MappingEntry[] = [
    ...keep.map(oldId => ({ oldId, action: "keep" as const, cluster: null })),
    { oldId: mergeFrom, action: "merge", toId: mergeTo, cluster: "EX-004" },
    ...tests.map(oldId => ({ oldId, action: "archive" as const, cluster: null })),
    ...archived.map(oldId => ({ oldId, action: "archive" as const, cluster: null, reviewHintOnly: ["same name as a survivor"] })),
    { oldId: "menu-item:staging:only", action: "archive", cluster: null },
  ];
  const references = [{ label: "published-week", sha256: "0".repeat(64), ids: [...rolling, keep[0], keep[3], mergeFrom].sort() }];
  const inputs: CutoverInputs = { survivorIds: [...keep], mappings, nineRollingIds: rolling, v2Records, references, allowedDuplicateNames: [], hashes: { survivors: digest(keep), mappings: digest(mappings), v2Source: digest([...v2Records.keys()]), allowlist: digest([]) } };
  return { store, inputs, v1, ids: { keep, tags, tests, mergeFrom, mergeTo, archived, rolling, sandwich } };
}

export const clockFrom = (start = NOW) => { let tick = 0; return () => new Date(Date.parse(start) + (tick++) * 1000).toISOString(); };
/** Returns a fixed timestamp so two independent runs produce byte-identical results. */
export const fixedNow = () => NOW;
