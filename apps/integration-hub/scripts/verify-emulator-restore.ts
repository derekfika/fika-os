import fs from "node:fs";
import path from "node:path";
import { createInventory, type EmulatorInventory } from "./emulator-inventory";

const inventoryPath = path.resolve(process.argv[2] || "");
if (!fs.existsSync(inventoryPath)) throw new Error("Pass the backup inventory.json path.");
const expected = JSON.parse(fs.readFileSync(inventoryPath, "utf8")) as EmulatorInventory;
const actual = await createInventory();
const comparable = (inventory: EmulatorInventory) => inventory.collections.map(({ path: collectionPath, documentCount, contentHash, schemaVersions }) => ({ path: collectionPath, documentCount, contentHash, schemaVersions }));
if (JSON.stringify(comparable(expected)) !== JSON.stringify(comparable(actual))) {
  console.error(JSON.stringify({ restored: false, expected: comparable(expected), actual: comparable(actual) }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({ restored: true, inventory: inventoryPath, aggregateHash: actual.aggregateHash, collections: actual.collections }, null, 2));
