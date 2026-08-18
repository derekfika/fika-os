import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { CollectionReference, DocumentData, QueryDocumentSnapshot } from "firebase-admin/firestore";
import { db } from "../lib/firebase-admin";

export type EmulatorInventory = {
  format: "fika.integration-hub-emulator-inventory.v1";
  projectId: string;
  exportedAt: string;
  collections: { path: string; documentCount: number; contentHash: string; schemaVersions: string[] }[];
  aggregateHash: string;
  exportFiles?: { path: string; bytes: number; sha256: string }[];
};

function stable(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  const record = value as Record<string, unknown>;
  if (typeof record.toDate === "function") return JSON.stringify((record.toDate as () => Date)().toISOString());
  return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${stable(record[key])}`).join(",")}}`;
}

async function inspectCollection(collection: CollectionReference<DocumentData>, output: EmulatorInventory["collections"]): Promise<void> {
  const documents: QueryDocumentSnapshot[] = [];
  let cursor: QueryDocumentSnapshot | undefined;
  do {
    let query = collection.orderBy("__name__").limit(100);
    if (cursor) query = query.startAfter(cursor);
    const page = await query.get();
    documents.push(...page.docs);
    cursor = page.size === 100 ? page.docs.at(-1) : undefined;
  } while (cursor);
  const rows = documents.map(document => `${document.id}\u0000${stable(document.data())}`).sort();
  const schemaVersions = [...new Set(documents.flatMap(document => collectSchemaVersions(document.data())))].sort();
  output.push({ path: collection.path, documentCount: documents.length, contentHash: crypto.createHash("sha256").update(rows.join("\n")).digest("hex"), schemaVersions });
  for (const document of documents) for (const child of await document.ref.listCollections()) await inspectCollection(child, output);
}

function collectSchemaVersions(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap(collectSchemaVersions);
  const record = value as Record<string, unknown>;
  return [...(typeof record.schemaVersion === "string" ? [record.schemaVersion] : []), ...Object.values(record).flatMap(collectSchemaVersions)];
}

export async function createInventory(exportRoot?: string): Promise<EmulatorInventory> {
  const collections: EmulatorInventory["collections"] = [];
  for (const collection of await db.listCollections()) await inspectCollection(collection, collections);
  collections.sort((a, b) => a.path.localeCompare(b.path));
  const inventory: EmulatorInventory = { format: "fika.integration-hub-emulator-inventory.v1", projectId: process.env.FIREBASE_PROJECT_ID || "", exportedAt: new Date().toISOString(), collections, aggregateHash: crypto.createHash("sha256").update(stable(collections)).digest("hex") };
  if (exportRoot && fs.existsSync(exportRoot)) inventory.exportFiles = walk(exportRoot).filter(file => path.basename(file) !== "inventory.json").map(file => ({ path: path.relative(exportRoot, file).replaceAll("\\", "/"), bytes: fs.statSync(file).size, sha256: crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex") })).sort((a, b) => a.path.localeCompare(b.path));
  return inventory;
}

function walk(root: string): string[] { return fs.readdirSync(root, { withFileTypes: true }).flatMap(entry => { const target = path.join(root, entry.name); return entry.isDirectory() ? walk(target) : [target]; }); }

if (process.argv[1]?.endsWith("emulator-inventory.ts")) console.log(JSON.stringify(await createInventory(process.argv[2]), null, 2));
