import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createInventory } from "./emulator-inventory";

const root = path.resolve(process.env.INTEGRATION_HUB_DATA_ROOT || "../../local-data/integration-hub");
const target = path.join(root, "recovery", new Date().toISOString().replaceAll(":", "-"));
fs.mkdirSync(target, { recursive: true });
const firebase = path.resolve("node_modules/.bin/firebase.cmd");
const result = spawnSync(firebase, ["emulators:export", target, "--config", "firebase.json", "--force"], { stdio: "inherit", env: process.env, shell: true });
if (result.status !== 0) {
  if (result.error) console.error(result.error.message);
  process.exit(result.status || 1);
}
const inventory = await createInventory(target);
fs.writeFileSync(path.join(target, "inventory.json"), JSON.stringify(inventory, null, 2));
console.log(JSON.stringify({ backup: target, collections: inventory.collections, aggregateHash: inventory.aggregateHash }, null, 2));
