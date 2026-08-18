import assert from "node:assert/strict";
import test from "node:test";
import * as XLSX from "xlsx";
import { buildRotaWorkLocationEvidence, evidencePeriod, matchRotaLegend, parseAllSitesRota } from "../lib/rota-enrichment";

function syntheticRota() {
  const workbook = XLSX.utils.book_new();
  const addWeek = (name: string, date: Date, rows: unknown[][]) => {
    const worksheet = XLSX.utils.aoa_to_sheet([
      [],
      ["Week Commencing", "Monday", null, "Tuesday", null, "Wednesday", null, "Thursday", null, "Friday", null, "Saturday", null, "Sunday", null],
      ["Location", date],
      ...rows,
    ]);
    XLSX.utils.book_append_sheet(workbook, worksheet, name);
  };
  addWeek("Week 1", new Date("2026-07-06T00:00:00Z"), [
    ["Synthetic House", "Alex Example - Barista", "IN", "Alex Example - Barista", "IN"],
    [null, "Sam Example - Manager", "IN"],
    ["Relief Site", "Taylor Example - Relief", "IN"],
  ]);
  addWeek("Week 2", new Date("2026-07-13T00:00:00Z"), [
    ["Synthetic House", "Alex Example - Barista", "IN", "Alex Example - Barista", "IN"],
    ["Relief Site", "Sam Example - Manager", "IN"],
  ]);
  return Buffer.from(XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }));
}

test("All Sites Rota produces minimised name-to-site evidence", () => {
  const snapshot = parseAllSitesRota(syntheticRota());
  assert.equal(snapshot.worksheetCount, 2);
  assert.equal(snapshot.latestWeek, "2026-07-13");
  const alex = snapshot.legends.find(legend => legend.matchKey === "alex example");
  assert.equal(alex?.sites[0].name, "Synthetic House");
  assert.equal(alex?.sites[0].weeksObserved, 2);
});

test("a uniquely dominant rota site is only returned as a suggestion", () => {
  const match = matchRotaLegend("Alex Example", parseAllSitesRota(syntheticRota()));
  assert.equal(match.rotaSiteMappingStatus, "matched-by-name-review-required");
  assert.equal(match.primarySiteSuggestion, "Synthetic House");
});

test("ambiguous BrightHR names are not auto-matched", () => {
  const match = matchRotaLegend("Alex Example", parseAllSitesRota(syntheticRota()), true);
  assert.equal(match.rotaSiteMappingStatus, "ambiguous-legend-name");
  assert.deepEqual(match.rotaSiteReferences, []);
});

test("matched rota sites become reviewable FIKA-owned workplace evidence", () => {
  const evidence = buildRotaWorkLocationEvidence(matchRotaLegend("Alex Example", parseAllSitesRota(syntheticRota())));
  assert.equal(evidence?.evidenceType, "all-sites-rota");
  assert.equal(evidence?.reviewStatus, "requires-review");
  assert.equal(evidence?.primarySiteSuggestion, "Synthetic House");
  assert.deepEqual(evidence?.siteReferences.map(site => site.name), ["Synthetic House"]);
});

test("rota dates distinguish historical, current and future scheduled evidence", () => {
  assert.equal(evidencePeriod("2026-07-01", "2026-07-28"), "historical");
  assert.equal(evidencePeriod("2026-07-28", "2026-07-28"), "current");
  assert.equal(evidencePeriod("2026-08-01", "2026-07-28"), "future-scheduled");
});
