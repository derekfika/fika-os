import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";
import { assertSafeLocalPath, dataRoot } from "./safety";

export type RotaSiteReference = {
  name: string;
  weeksObserved: number;
  appearances: number;
  latestWeek: string;
};

export type RotaLegendReference = {
  matchKey: string;
  displayName: string;
  sites: RotaSiteReference[];
};

export type RotaEnrichmentSnapshot = {
  schemaVersion: "fika.rota-site-enrichment.v1";
  sourceFileHash: string;
  importedAt: string;
  worksheetCount: number;
  latestWeek: string;
  legends: RotaLegendReference[];
};

const SNAPSHOT_PATH = "snapshots/rota-site-enrichment.json";
const PERSON_COLUMNS = [1, 3, 5, 7, 9, 11, 13];

export function parseAllSitesRota(buffer: Buffer): RotaEnrichmentSnapshot {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
  if (!workbook.SheetNames.length) throw new Error("The rota workbook has no worksheets.");

  const evidence = new Map<string, { displayName: string; sites: Map<string, { weeks: Set<string>; appearances: number; latestWeek: string }> }>();
  let recognisedSheets = 0;
  let latestWeek = "";

  for (const sheetName of workbook.SheetNames) {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], { header: 1, defval: null, raw: true });
    const weekHeaderIndex = rows.findIndex(row => normaliseText(row[0]) === "week commencing");
    const locationHeaderIndex = rows.findIndex((row, index) => index > weekHeaderIndex && normaliseText(row[0]) === "location");
    if (weekHeaderIndex < 0 || locationHeaderIndex < 0) continue;
    recognisedSheets += 1;
    const week = excelDate(rows[locationHeaderIndex]?.[1]) || sheetName;
    if (week > latestWeek) latestWeek = week;
    let currentSite = "";
    const seenThisWeek = new Set<string>();

    for (const row of rows.slice(locationHeaderIndex + 1)) {
      const suppliedSite = cleanCell(row[0]);
      if (suppliedSite) currentSite = suppliedSite;
      if (!currentSite) continue;

      for (const column of PERSON_COLUMNS) {
        const displayName = extractRotaLegendName(row[column]);
        if (!displayName) continue;
        const matchKey = normaliseLegendName(displayName);
        if (!matchKey) continue;
        const legend = evidence.get(matchKey) || { displayName, sites: new Map() };
        const site = legend.sites.get(currentSite) || { weeks: new Set<string>(), appearances: 0, latestWeek: "" };
        site.appearances += 1;
        if (!seenThisWeek.has(`${matchKey}\u0000${currentSite}`)) {
          site.weeks.add(week);
          seenThisWeek.add(`${matchKey}\u0000${currentSite}`);
        }
        if (week > site.latestWeek) site.latestWeek = week;
        legend.sites.set(currentSite, site);
        evidence.set(matchKey, legend);
      }
    }
  }

  if (!recognisedSheets) throw new Error("This workbook does not match the All Sites Rota layout.");
  const legends = [...evidence.entries()].map(([matchKey, legend]) => ({
    matchKey,
    displayName: legend.displayName,
    sites: [...legend.sites.entries()].map(([name, site]) => ({ name, weeksObserved: site.weeks.size, appearances: site.appearances, latestWeek: site.latestWeek })).sort((a, b) => b.weeksObserved - a.weeksObserved || b.appearances - a.appearances || a.name.localeCompare(b.name)),
  })).sort((a, b) => a.matchKey.localeCompare(b.matchKey));

  return { schemaVersion: "fika.rota-site-enrichment.v1", sourceFileHash: crypto.createHash("sha256").update(buffer).digest("hex"), importedAt: new Date().toISOString(), worksheetCount: recognisedSheets, latestWeek, legends };
}

export function matchRotaLegend(displayName: string, snapshot: RotaEnrichmentSnapshot | null, duplicateName = false) {
  if (!snapshot) return { rotaSiteReferences: [] as RotaSiteReference[], rotaSiteMappingStatus: "rota-not-imported" as const };
  if (duplicateName) return { rotaSiteReferences: [] as RotaSiteReference[], rotaSiteMappingStatus: "ambiguous-legend-name" as const };
  const match = snapshot.legends.find(legend => legend.matchKey === normaliseLegendName(displayName));
  if (!match) return { rotaSiteReferences: [] as RotaSiteReference[], rotaSiteMappingStatus: "no-exact-rota-match" as const };
  const first = match.sites[0];
  const second = match.sites[1];
  const primarySiteSuggestion = first && (!second || first.weeksObserved > second.weeksObserved) ? first.name : undefined;
  return { rotaSiteReferences: match.sites, rotaSiteMappingStatus: "matched-by-name-review-required" as const, primarySiteSuggestion, rotaSourceHash: snapshot.sourceFileHash, rotaLatestWeek: snapshot.latestWeek };
}

export function buildRotaWorkLocationEvidence(enrichment: ReturnType<typeof matchRotaLegend>) {
  return buildRotaWorkLocationEvidenceFromNormalised(enrichment);
}

export function buildRotaWorkLocationEvidenceFromNormalised(values: Record<string, unknown>) {
  if (values.rotaSiteMappingStatus !== "matched-by-name-review-required" || !Array.isArray(values.rotaSiteReferences) || !values.rotaSiteReferences.length) return null;
  return {
    evidenceType: "all-sites-rota",
    sourceFileHash: values.rotaSourceHash,
    latestWeek: values.rotaLatestWeek,
    matchMethod: "exact-normalised-name",
    reviewStatus: "requires-review",
    primarySiteSuggestion: values.primarySiteSuggestion,
    siteReferences: (values.rotaSiteReferences as RotaSiteReference[]).map(reference => ({ ...reference, evidencePeriod: evidencePeriod(reference.latestWeek) })),
  };
}

export function evidencePeriod(week: string, today = new Date().toISOString().slice(0, 10)) {
  if (week > today) return "future-scheduled" as const;
  if (week === today) return "current" as const;
  return "historical" as const;
}

export function saveRotaEnrichment(snapshot: RotaEnrichmentSnapshot) {
  const target = assertSafeLocalPath(path.join(dataRoot(), SNAPSHOT_PATH));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(snapshot));
}

export function loadRotaEnrichment(): RotaEnrichmentSnapshot | null {
  const target = assertSafeLocalPath(path.join(dataRoot(), SNAPSHOT_PATH));
  if (!fs.existsSync(target)) return null;
  return JSON.parse(fs.readFileSync(target, "utf8")) as RotaEnrichmentSnapshot;
}

export function normaliseLegendName(value: string) {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

export function extractRotaLegendName(value: unknown) {
  const text = cleanCell(value);
  if (!text) return "";
  const displayName = text.split(/\s+-\s+/, 1)[0].trim();
  if (!displayName || /^(agency|no manager|vacan|cover|closed|tbc|n\/a|none)\b/i.test(displayName)) return "";
  return displayName;
}

function cleanCell(value: unknown) {
  return typeof value === "string" || typeof value === "number" ? String(value).trim().replace(/\s+/g, " ") : "";
}

function normaliseText(value: unknown) {
  return cleanCell(value).toLowerCase();
}

function excelDate(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.valueOf())) return value.toISOString().slice(0, 10);
  if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) return `${parsed.y}-${String(parsed.m).padStart(2, "0")}-${String(parsed.d).padStart(2, "0")}`;
  }
  const parsed = new Date(String(value || ""));
  return Number.isNaN(parsed.valueOf()) ? "" : parsed.toISOString().slice(0, 10);
}
