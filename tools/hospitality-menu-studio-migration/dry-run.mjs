import { closeSync, fstatSync, openSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { planRotationMigration } from "./plan.mjs";

const MAX_BYTES = 256 * 1024 * 1024;
const [file, ...extras] = process.argv.slice(2);
if (!file || extras.length || file.startsWith("-") || /^(?:[/\\]{2}|[a-z]+:\/\/)/i.test(file)) {
  console.error("Usage: node tools/hospitality-menu-studio-migration/dry-run.mjs <local-export.json>");
  process.exitCode = 64;
} else {
  let source;
  let descriptor;
  try {
    descriptor = openSync(resolve(file), "r");
    const stat = fstatSync(descriptor);
    if (!stat.isFile() || stat.size > MAX_BYTES) throw new Error("Provide a regular file of at most 256 MiB.");
    const bytes = readFileSync(descriptor);
    if (bytes.length > MAX_BYTES || fstatSync(descriptor).mtimeMs !== stat.mtimeMs || bytes.length !== stat.size) {
      throw new Error("The export changed while it was being read.");
    }
    source = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    console.error("Could not read an unchanged local UTF-8 JSON export of at most 256 MiB.");
    process.exitCode = 65;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
  if (!process.exitCode) {
    const result = planRotationMigration(source);
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.status === "INVALID_EXPORT" ? 65 : result.status === "BLOCKED" ? 2 : 0;
  }
}
