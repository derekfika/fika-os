import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { normaliseOperationalAllergens } from "@fika/contracts";
import { productionItemId } from "../lib/production-item-id.ts";

const appRoot = path.resolve(import.meta.dirname, "..");
const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const arg = process.argv[index];
  if (arg === "--write" || arg === "--help") args.set(arg, true);
  else if (arg.startsWith("--")) args.set(arg, process.argv[++index]);
}
if (args.has("--help")) {
  console.log("Usage: node scripts/migrate-production-items.mjs [--write] [--saved-file path] [--output path]");
  process.exit(0);
}

const sourceFiles = [
  ["local-saved", args.get("--saved-file") || path.resolve(appRoot, "../../local-data/menu-planning/saved-sandwiches.json"), 3],
  ["production-seed", path.join(appRoot, "data/production-items-seed.json"), 2],
  ["delivered-seed", path.join(appRoot, "data/delivered-in-lunch-items-seed.json"), 1],
];
const readArray = (file) => {
  const value = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!Array.isArray(value)) throw new Error(`Expected an item array: ${file}`);
  return value;
};
const slug = (value) => value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "untitled";
const identity = (item) => productionItemId(item.title, item.parentMenuItemKey);
const sourceRows = sourceFiles.flatMap(([source, file, priority]) => readArray(file).map((item, index) => ({ source, file, priority, index, item })));
const groups = new Map();
for (const row of sourceRows) {
  if (!row.item || typeof row.item.title !== "string" || typeof row.item.parentMenuItemKey !== "string" || !row.item.parentMenuItemKey.trim()) continue;
  const key = identity(row.item);
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(row);
}

const nonEmpty = (value) => typeof value === "string" && value.trim() ? value : undefined;
const evidence = (rows) => [...new Set(rows.flatMap(({ item }) => Array.isArray(item.sourceEvidence) ? item.sourceEvidence : []).filter((value) => typeof value === "string" && value.trim()))];
const mergeGroup = (key, rows) => {
  const ordered = rows.slice().sort((a, b) => b.priority - a.priority || (b.item.updatedAt || "").localeCompare(a.item.updatedAt || "") || a.index - b.index);
  const preferred = ordered[0].item;
  const allergenRows = ordered.slice().sort((a, b) => {
    const count = (row) => row.item.allergens && typeof row.item.allergens === "object" ? Object.keys(row.item.allergens).length : 0;
    return count(b) - count(a) || b.priority - a.priority;
  });
  const allergens = {};
  for (const row of allergenRows.slice().reverse()) Object.assign(allergens, normaliseOperationalAllergens(row.item.allergens));
  for (const row of allergenRows) Object.assign(allergens, normaliseOperationalAllergens(row.item.allergens));
  const merged = {
    id: key,
    title: preferred.title.trim(),
    ...(nonEmpty(preferred.itemType) ? { itemType: preferred.itemType } : {}),
    parentMenuItemKey: preferred.parentMenuItemKey.trim(),
    ...(nonEmpty(preferred.category) ? { category: preferred.category } : {}),
    allergens: normaliseOperationalAllergens(allergens),
    ...(rows.map(({ item }) => nonEmpty(item.mayContainNotes)).find(Boolean) ? { mayContainNotes: rows.map(({ item }) => nonEmpty(item.mayContainNotes)).find(Boolean) } : {}),
    ...(evidence(rows).length ? { sourceEvidence: evidence(rows) } : {}),
    ...(rows.map(({ item }) => nonEmpty(item.createdAt)).find(Boolean) ? { createdAt: rows.map(({ item }) => nonEmpty(item.createdAt)).find(Boolean) } : {}),
    ...(rows.map(({ item }) => nonEmpty(item.updatedAt)).sort().at(-1) ? { updatedAt: rows.map(({ item }) => nonEmpty(item.updatedAt)).sort().at(-1) } : { updatedAt: "migration" }),
    updatedBy: nonEmpty(preferred.updatedBy) || "cpu-production-library-migration",
  };
  return merged;
};
const items = [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, rows]) => mergeGroup(key, rows));
const ambiguous = sourceRows.filter(({ item }) => !item || typeof item.parentMenuItemKey !== "string" || !item.parentMenuItemKey.trim());
const byBank = Object.groupBy(items, (item) => item.parentMenuItemKey);
const byType = Object.groupBy(items, (item) => (item.itemType || "other").toLowerCase());
const conflicts = [...groups.values()].filter((rows) => new Set(rows.map(({ item }) => JSON.stringify(item.allergens || {}))).size > 1);
const report = {
  sourceCounts: Object.fromEntries(sourceFiles.map(([source, file]) => [source, readArray(file).length])),
  inputRows: sourceRows.length,
  totalUniqueCanonicalItems: items.length,
  parentMenuItemBanks: Object.fromEntries(Object.entries(byBank).map(([key, values]) => [key, values.length])),
  itemTypes: { sandwiches: byType.sandwich?.length || 0, salads: byType.salad?.length || 0, pastries: byType.pastry?.length || 0, desserts: byType.dessert?.length || 0, other: byType.other?.length || 0 },
  recordsWithAllergenData: items.filter((item) => Object.keys(item.allergens).length > 0).length,
  duplicatesRemoved: sourceRows.length - items.length,
  conflictsResolved: conflicts.length,
  ambiguousRecords: ambiguous.length,
  samples: Object.fromEntries(Object.entries(byBank).map(([key, values]) => [key, values.slice(0, 5).map(({ id, title, itemType, category }) => ({ id, title, itemType, category }))])),
};
console.log(JSON.stringify(report, null, 2));
if (args.get("--output")) fs.writeFileSync(path.resolve(args.get("--output")), `${JSON.stringify({ schemaVersion: 1, collection: "fikaCpuProductionItemsV1", items }, null, 2)}\n`);
if (!args.has("--write")) process.exit(0);
if (process.env.FIREBASE_PROJECT_ID !== "fika-os-dev") throw new Error("Refusing migration: set FIREBASE_PROJECT_ID=fika-os-dev explicitly.");
if (process.env.FIRESTORE_EMULATOR_HOST) throw new Error("Refusing migration against a Firestore emulator.");
const { getApps, initializeApp } = await import("firebase-admin/app");
const { getFirestore } = await import("firebase-admin/firestore");
const app = getApps().find((candidate) => candidate.name === "[DEFAULT]") || initializeApp({ projectId: "fika-os-dev" });
const db = getFirestore(app);
const collection = db.collection("fikaCpuProductionItemsV1");
for (let start = 0; start < items.length; start += 400) {
  const batch = db.batch();
  for (const item of items.slice(start, start + 400)) batch.set(collection.doc(item.id), item);
  await batch.commit();
}
const verify = await collection.get();
if (verify.size !== items.length) throw new Error(`Migration verification failed: expected ${items.length}, found ${verify.size}.`);
console.log(JSON.stringify({ migrated: items.length, verified: verify.size, project: "fika-os-dev", collection: "fikaCpuProductionItemsV1" }));
