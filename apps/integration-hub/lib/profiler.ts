import crypto from "node:crypto";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import type { CanonicalEntityType } from "./schemas";
import type { ColumnProfile, WorkbookProfile, WorksheetProfile } from "./types";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE = /^\d{4}-\d{1,2}-\d{1,2}|^\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}/;
const CURRENCY = /^[£$€]?\s*-?\d+(?:[,.]\d+)?$/;
const SENSITIVE = /email|phone|mobile|address|name|employee|absence|date of birth|dob/i;

export function sha256(value: Buffer | string) { return crypto.createHash("sha256").update(value).digest("hex"); }
export function stableId(prefix: string, seed: string) { return `${prefix}:${sha256(seed).slice(0, 20)}`; }

export function detectHeaderRow(rows: unknown[][]) {
  let best = 0, score = -1;
  rows.slice(0, 20).forEach((row, index) => {
    const strings = row.filter(v => String(v ?? "").trim());
    const unique = new Set(strings.map(v => String(v).trim().toLowerCase())).size;
    const current = strings.length * 2 + unique - index * 0.1;
    if (current > score) { score = current; best = index; }
  });
  return best;
}

function infer(values: unknown[]) {
  const present = values.filter(v => v !== null && v !== undefined && String(v).trim() !== "");
  if (!present.length) return "unknown";
  if (present.every(v => typeof v === "number" || /^-?\d+(\.\d+)?$/.test(String(v)))) return "number";
  if (present.every(v => typeof v === "boolean" || /^(true|false|yes|no)$/i.test(String(v)))) return "boolean";
  if (present.every(v => EMAIL.test(String(v)))) return "email";
  if (present.every(v => DATE.test(String(v)))) return "date";
  if (present.every(v => CURRENCY.test(String(v)))) return "currency";
  return "text";
}

function worksheetProfile(name: string, rows: unknown[][], merged: boolean): WorksheetProfile {
  const headerIndex = detectHeaderRow(rows);
  const headers = (rows[headerIndex] || []).map((v, i) => String(v ?? "").trim() || `Unnamed column ${i + 1}`);
  const dataRows = rows.slice(headerIndex + 1).filter(r => r.some(v => String(v ?? "").trim()));
  const isRepeatedHeader = (row: unknown[]) => headers.every((h, i) => !h || String(row[i] ?? "").trim().toLowerCase() === h.toLowerCase());
  const repeatedHeaders = dataRows.filter(isRepeatedHeader).length;
  const records = dataRows.map((row, index) => ({ row, sourceRow: headerIndex + 2 + index })).filter(entry => !isRepeatedHeader(entry.row));
  const columns: ColumnProfile[] = headers.map((column, index) => {
    const values = dataRows.map(row => row[index]);
    const present = values.filter(v => String(v ?? "").trim());
    const unique = new Set(present.map(v => String(v).trim().toLowerCase()));
    return { name: column, inferredType: infer(values), blankPercentage: values.length ? Math.round((1 - present.length / values.length) * 1000) / 10 : 100, uniqueValues: unique.size, examples: [...unique].slice(0, 3), likelyIdentifier: /(^id$|_id$|code|reference|sku|email)/i.test(column) || (present.length > 2 && unique.size === present.length), sensitive: SENSITIVE.test(column) };
  });
  const preview = records.slice(0, 100).map(entry => ({ ...Object.fromEntries(headers.map((h, i) => [h, entry.row[i] ?? null])), __fikaSourceRow: entry.sourceRow }));
  const warnings = [merged ? "Merged cells detected; heading meaning requires review." : "", repeatedHeaders ? `${repeatedHeaders} repeated header row(s) detected and excluded from staging.` : ""].filter(Boolean);
  return { name, rowCount: records.length, columnCount: headers.length, headerRow: headerIndex + 1, columns, warnings, preview, sourceRows: records.map(record => record.sourceRow) };
}

export function inferEntity(columns: string[]): CanonicalEntityType | "Unknown Dataset" {
  const joined = columns.join(" ").toLowerCase();
  if (/employee|work email|job title/.test(joined)) return "Legend";
  if (/absence|leave type|start date.*end date/.test(joined)) return "Absence";
  if (/sku|variation|catalog item|till item/.test(joined)) return "Till Item";
  if (/site name|square location/.test(joined)) return "Site";
  if (/operational location|oploc/.test(joined)) return "OPLOC";
  return "Unknown Dataset";
}

export function parseWorkbook(filename: string, buffer: Buffer, importedBy: string): WorkbookProfile {
  const ext = filename.toLowerCase().split(".").pop();
  if (!(["csv", "xlsx", "xls"] as string[]).includes(ext || "")) throw new Error("Only CSV, XLSX and safe data-only XLS files are supported.");
  const fileHash = sha256(buffer);
  const worksheets: WorksheetProfile[] = [];
  if (ext === "csv") {
    const parsed = Papa.parse<string[]>(buffer.toString("utf8"), { skipEmptyLines: false });
    if (parsed.errors.length) throw new Error(`CSV parsing failed at row ${parsed.errors[0].row ?? "unknown"}.`);
    worksheets.push(worksheetProfile("CSV", parsed.data as unknown[][], false));
  } else {
    const workbook = XLSX.read(buffer, { type: "buffer", cellFormula: false, cellDates: true, bookVBA: false });
    for (const name of workbook.SheetNames) {
      const sheet = workbook.Sheets[name];
      const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, defval: null });
      worksheets.push(worksheetProfile(name, rows, Boolean(sheet["!merges"]?.length)));
    }
  }
  const columns = worksheets.flatMap(w => w.columns.map(c => c.name));
  const proposedEntity = inferEntity(columns);
  return { importId: stableId("import", `${fileHash}:${importedBy}`), filename, fileHash, worksheets, proposedEntity, draftSchema: { status: "draft-proposal", fields: worksheets[0]?.columns.map(c => ({ name: c.name.replace(/[^a-zA-Z0-9 _-]/g, "").slice(0, 80), type: c.inferredType, nullable: c.blankPercentage > 0 })) || [] } };
}
