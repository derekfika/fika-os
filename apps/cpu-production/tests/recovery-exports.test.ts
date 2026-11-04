import assert from "node:assert/strict";
import test from "node:test";
import { allergenMatrixHtml } from "../app/ui/allergen-matrix";
import type { PlannedMenuItem } from "../app/lib/production-plan";
type ExportMenuItem = Omit<PlannedMenuItem, "subItems"> & { subItems: Array<PlannedMenuItem["subItems"][number] & { allergenDetailNotes?: string }> };

test("CPU exported checker keeps confirmed specifics distinct from may-contain qualifications and escapes both", () => {
  const items: ExportMenuItem[] = [{ id: "menu:test", name: "Synthetic dish", note: "", subItems: [{ id: "sub:test", name: "Synthetic dish", quantity: 1, allergens: { tree_nuts: "contains" }, evidenceStatus: "completed", note: "", allergenDetailNotes: "Almond & cashew <test>", mayContainNotes: "Shared sesame equipment <test>" }] }];
  const html = allergenMatrixHtml({ requiredBy: "2098-11-02T12:00", destinationLabel: "Synthetic venue" }, items);
  assert.match(html, /Specific allergens:<\/strong> Almond &amp; cashew &lt;test&gt;/);
  assert.match(html, /May contain:<\/strong> Shared sesame equipment &lt;test&gt;/);
  assert.doesNotMatch(html, /cashew <test>/);
});

test("legacy exports omit absent/blank notes and preserve unknown and may-contain states", () => {
  for (const details of [undefined, "   "]) {
    const items: ExportMenuItem[] = [{ id: "menu:test", name: "Synthetic", note: "", subItems: [{ id: "sub:test", name: "Synthetic", quantity: 1, allergens: { sesame: "may_contain" }, evidenceStatus: "not_completed", note: "", allergenDetailNotes: details, mayContainNotes: " " }] }];
    const html = allergenMatrixHtml({ requiredBy: "2098-11-02T12:00" }, items);
    assert.doesNotMatch(html, /<strong>Specific allergens:|<strong>May contain:/);
    assert.match(html, /class="may_contain">MC/);
    assert.match(html, /class="unrecorded">UR/);
    assert.match(html, /<td class="notes"><\/td>/);
  }
});

test("specific notes and may-contain qualifications can each be exported independently", () => {
  for (const [allergenDetailNotes, mayContainNotes, expected, absent] of [
    ["Wheat", "", "Specific allergens:", "May contain:"],
    ["", "Sesame", "May contain:", "Specific allergens:"],
  ]) {
    const items: ExportMenuItem[] = [{ id: "menu:test", name: "Synthetic", note: "", subItems: [{ id: "sub:test", name: "Synthetic", quantity: 1, allergens: {}, evidenceStatus: "not_completed", note: "", allergenDetailNotes, mayContainNotes }] }];
    const html = allergenMatrixHtml({ requiredBy: "2098-11-02T12:00" }, items);
    assert.ok(html.includes(`<strong>${expected}</strong>`));
    assert.ok(!html.includes(`<strong>${absent}</strong>`));
  }
});
