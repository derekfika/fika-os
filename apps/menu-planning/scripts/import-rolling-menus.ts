import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { importWorkbook, saveSnapshot } from "../lib/rolling-menu";

const root = join(process.cwd(), "..", "..", "Menu Data");
const files = readdirSync(root).filter((name: string) => /\.xlsx?$/i.test(name));
const report: { scanned: string[]; weeks: Array<{ file: string; week: string; entries: number; warnings: string[] }> } = { scanned: files, weeks: [] };
for (const name of files) {
  const result = importWorkbook(readFileSync(join(root, name)), name);
  if (!result.recognisedEntries) {
    report.weeks.push({ file: name, week: result.snapshot.week.weekCommencing, entries: 0, warnings: ["No recognised day entries; retained as source evidence without replacing an existing week."] });
    continue;
  }
  saveSnapshot(result.snapshot);
  report.weeks.push({ file: name, week: result.snapshot.week.weekCommencing, entries: result.recognisedEntries, warnings: result.warnings });
}
mkdirSync(join(process.cwd(), "fixtures"), { recursive: true });
writeFileSync(join(process.cwd(), "fixtures", "rolling-menu-import-report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ files: files.length, weeks: report.weeks.length, entries: report.weeks.reduce((n, w) => n + w.entries, 0) }, null, 2));
