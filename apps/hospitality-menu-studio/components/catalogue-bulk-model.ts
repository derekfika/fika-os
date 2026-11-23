import { SERVICE_IDS } from "@fika/server-shared/hospitality-service-layout";
import type { CataloguePayload, CatalogueRow } from "./catalogue-wire";
export const routes = ["in_house", "cpu_hospitality", "cpu_sandwiches", "cpu_delivered_in"] as const;
export type Route = typeof routes[number];
export type ImportRow = { requestId: string; name: string; category: string; gross: string; vat: string; description: string; routing: string };

/** RFC-style quoted CSV/TSV fields including embedded line breaks and escaped quotes. */
export function parseDelimited(input: string, delimiter: "," | "\t"): string[][] {
  const rows: string[][] = []; let row: string[] = [], field = "", quoted = false, closed = false;
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (quoted) { if (c === '"') { if (input[i + 1] === '"') { field += '"'; i++; } else { quoted = false; closed = true; } } else field += c; continue; }
    if (c === '"') { if (field || closed) throw new Error("Unexpected quote in a field."); quoted = true; continue; }
    if (c === delimiter || c === "\n" || c === "\r") { row.push(field); field = ""; closed = false; if (c !== delimiter) { if (c === "\r" && input[i + 1] === "\n") i++; if (row.some(value => value.trim())) rows.push(row); row = []; } continue; }
    if (closed) throw new Error("Unexpected text after a closing quote.");
    field += c;
  }
  if (quoted) throw new Error("A quoted field is not closed.");
  row.push(field); if (row.some(value => value.trim())) rows.push(row);
  return rows;
}
export function importRows(input: string, delimiter: "," | "\t", id: () => string): ImportRow[] {
  const data = parseDelimited(input.replace(/^\uFEFF/, ""), delimiter);
  if (data.length && /^(item name|name)$/i.test(data[0][0].trim()) && /category/i.test(data[0][1] || "")) data.shift();
  if (!data.length || data.length > 50 || data.some(row => row.length > 6)) throw new Error("Provide 1–50 rows with at most six columns.");
  return data.map(row => ({ requestId: id(), name: (row[0] || "").trim(), category: (row[1] || "").trim(), gross: (row[2] || "").trim().replace(/^£/, ""), vat: (row[3] ?? "20").trim().replace(/%$/, ""), description: (row[4] || "").trim(), routing: (row[5] || "").trim() }));
}
export function exVat(gross: string, percent: string): number | null {
  if (!gross.trim() || !percent.trim()) return null;
  const g = Number(gross), p = Number(percent);
  if (!Number.isFinite(g) || g <= 0 || !Number.isFinite(p) || p < 0 || p > 100) return null;
  return Math.round((g / (1 + p / 100) + Number.EPSILON) * 100) / 100;
}
const key = (value: string) => value.trim().toLocaleLowerCase("en-GB").replace(/\s+/g, " ");
export function importProblems(rows: ImportRow[], payload: CataloguePayload): string[] {
  const existing = new Set(payload.rows.map(row => key(row.name))), seen = new Set<string>();
  return rows.map(row => { const name = key(row.name); const duplicate = seen.has(name) || existing.has(name); seen.add(name); return !name || row.name.length > 240 || !row.category.trim() || row.category.length > 160 || row.description.length > 4000 || !routes.includes(row.routing as Route) || exVat(row.gross, row.vat) === null ? "Complete the name, category, price, VAT and production route." : duplicate ? "Possible duplicate name; review the existing product." : ""; });
}
export function categoryEffects(payload: CataloguePayload, rows: CatalogueRow[], target: string) {
  const layout = payload.serviceLayout;
  if (!layout) return { safe: false, changes: ["Stored service configuration is unavailable."] };
  const changes: string[] = []; let safe = true;
  for (const row of rows) for (const site of row.availableAt) {
    if (row.category === target) continue;
    const services = (category: string) => SERVICE_IDS.filter(id => { const rule = layout.sites[site]?.services[id] ?? layout.company.services[id]; return rule && !rule.hidden && rule.categories.includes(category); });
    const before = services(row.category), after = services(target);
    if (!after.length) safe = false;
    if (before.join("|") !== after.join("|") || !after.length) changes.push(`${row.name} · ${payload.oplocs.find(loc => loc.oplocId === site)?.label || site}: ${before.join(", ") || "no service"} → ${after.join(", ") || "no visible service (held)"}`);
  }
  return { safe, changes };
}
