import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
const XLSX = createRequire(import.meta.url)("xlsx") as typeof import("xlsx");

export type SourcePackKind = "regional_recipe_pack" | "delivered_in_lunch_workbooks";

export type SourcePackFile = {
  relativePath: string;
  extension: string;
  bytes: number;
  evidenceOnly: true;
  reviewState: "unreviewed";
  workbook?: { sheets: Array<{ name: string; rows: number; columns: number; structure: string; candidateSignals: number }> };
};

export type SourcePackManifest = {
  version: "1.0.0";
  generatedAt: string;
  packs: Array<{
    id: string;
    kind: SourcePackKind;
    label: string;
    sourceName: string;
    evidenceOnly: true;
    reviewState: "unreviewed";
    fileCount: number;
    workbookCount: number;
    candidateSignals: number;
    files: SourcePackFile[];
  }>;
  rules: string[];
};

function walk(root: string): string[] {
  if (!fs.existsSync(root)) return [];
  const result: string[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) result.push(...walk(absolute)); else result.push(absolute);
  }
  return result;
}

function classifySheet(rows: unknown[][]): { structure: string; candidateSignals: number } {
  const text = rows.flat().filter(value => value !== null && value !== undefined).map(String).join(" ").toLowerCase();
  if (text.includes("allergen checker")) return { structure: "allergen-review", candidateSignals: 0 };
  const header = rows.slice(0, 5).flat().map(value => String(value ?? "").toLowerCase());
  const candidateSignals = rows.slice(0, 200).filter(row => String(row[0] ?? "").trim() && String(row[1] ?? "").trim()).length;
  if (header.some(value => value.includes("product")) || header.some(value => value.includes("dish"))) return { structure: "day-menu", candidateSignals };
  return { structure: "source-sheet", candidateSignals: 0 };
}

function describeWorkbook(file: string, root: string): SourcePackFile {
  const relativePath = path.relative(root, file).replaceAll(path.sep, "/");
  const result: SourcePackFile = { relativePath, extension: path.extname(file).toLowerCase(), bytes: fs.statSync(file).size, evidenceOnly: true, reviewState: "unreviewed" };
  if (result.extension === ".xlsx" || result.extension === ".xls") {
    const workbook = XLSX.readFile(file, { cellDates: false });
    const sheets = workbook.SheetNames.map(name => {
      const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[name], { header: 1, defval: null });
      const shape = classifySheet(rows);
      return { name, rows: rows.length, columns: rows.reduce((max, row) => Math.max(max, row.length), 0), ...shape };
    });
    result.workbook = { sheets };
  }
  return result;
}

export function buildSourcePackManifest(regionalRoot: string, weeklyRoot: string, generatedAt = "1970-01-01T00:00:00.000Z"): SourcePackManifest {
  const makePack = (id: string, kind: SourcePackKind, label: string, sourceName: string, root: string) => {
    const files = walk(root).sort().map(file => describeWorkbook(file, root));
    return { id, kind, label, sourceName, evidenceOnly: true as const, reviewState: "unreviewed" as const, fileCount: files.length, workbookCount: files.filter(file => file.workbook).length, candidateSignals: files.reduce((sum, file) => sum + (file.workbook?.sheets.reduce((n, sheet) => n + sheet.candidateSignals, 0) || 0), 0), files };
  };
  return {
    version: "1.0.0",
    generatedAt,
    packs: [
      makePack("source-pack:regional-menus-2026", "regional_recipe_pack", "Regional menus and recipes", "REGIONAL MENUS 2026", regionalRoot),
      makePack("source-pack:weekly-menus-haleon", "delivered_in_lunch_workbooks", "Weekly delivered-in lunch menus", "WEEKLEY MENUS NUMBERS HALEON", weeklyRoot),
    ],
    rules: [
      "Source files are retained as evidence and are never canonical truth by themselves.",
      "Rows and recipe content remain unreviewed until a menu item is deliberately created or mapped.",
      "Display-name similarity may suggest a match but never silently maps or merges records.",
      "CPU Production consumes published menu data; it does not own menu creation or recipes.",
    ],
  };
}
