import { readFile } from "node:fs/promises";
import { inspectWorkbook } from "../lib/importer";

const file = process.argv[2];
if (!file) throw new Error("Usage: npm run inspect-workbook -- <path-to-xlsx>");
const report = inspectWorkbook(await readFile(file), file.split(/[\\/]/).pop() || file);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
