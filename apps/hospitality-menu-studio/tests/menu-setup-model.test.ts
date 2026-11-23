import assert from "node:assert/strict";
import test from "node:test";
import { rotationWeek, type Section } from "../lib/contract";
import {
  catalogueOptionLabel,
  catalogueSuggestion,
  menuSetupIssue,
  openingWeekMonday,
  type CatalogueChoices,
} from "../components/menu-setup-model";

const section: Section = {
  id: "food",
  name: "Canapés",
  mode: "rotation",
  catalogueItemId: "",
  staticDishIds: [],
  weeks: [[], [], [], [], [], []],
};

test("the opening Monday follows London calendar dates across DST and the new year", () => {
  assert.equal(openingWeekMonday("2026-03-30"), "2026-03-30");
  assert.equal(openingWeekMonday("2026-03-29"), "2026-03-23");
  assert.equal(openingWeekMonday("2026-10-25"), "2026-10-19");
  assert.equal(openingWeekMonday("2027-01-01"), "2026-12-28");
  assert.equal(rotationWeek(openingWeekMonday("2027-01-01"), "2027-02-08"), 1);
  assert.equal(openingWeekMonday(""), "");
  assert.equal(openingWeekMonday("2026-02-31"), "");
});

test("draft setup allows undecided dates and rejects reversed dates or a non-Monday anchor", () => {
  assert.equal(
    menuSetupIssue({ startDate: "", endDate: "", anchorMonday: "" }),
    "",
  );
  assert.match(
    menuSetupIssue({
      startDate: "2027-02-01",
      endDate: "2027-01-31",
      anchorMonday: "",
    }),
    /end date/,
  );
  assert.match(
    menuSetupIssue({ startDate: "", endDate: "", anchorMonday: "2027-01-01" }),
    /Monday/,
  );
  assert.equal(
    menuSetupIssue({
      startDate: "2027-01-01",
      endDate: "2027-01-31",
      anchorMonday: "2026-12-28",
    }),
    "",
  );
});

test("only a unique exact name from the verified catalogue may be suggested", () => {
  const item = { id: "item-1", name: "Canapes", category: "Finger food" };
  const choices: CatalogueChoices = { state: "loaded", items: [item] };
  assert.deepEqual(catalogueSuggestion(section, choices, new Set()), {
    status: "suggested",
    item,
  });
  assert.deepEqual(
    catalogueSuggestion(
      { ...section, name: "Canapés & drinks" },
      choices,
      new Set(),
    ),
    { status: "none" },
  );
  assert.deepEqual(
    catalogueSuggestion(
      { ...section, catalogueItemId: "existing" },
      choices,
      new Set(),
    ),
    { status: "none" },
  );
  assert.deepEqual(
    catalogueSuggestion(section, { state: "unavailable" }, new Set()),
    { status: "none" },
  );
  assert.deepEqual(catalogueSuggestion(section, choices, new Set([item.id])), {
    status: "already-used",
  });
  assert.deepEqual(
    catalogueSuggestion(
      section,
      {
        state: "loaded",
        items: [item, { ...item, id: "item-2", category: "Receptions" }],
      },
      new Set(),
    ),
    { status: "ambiguous" },
  );
  assert.equal(catalogueOptionLabel(item), "Canapes · Finger food");
});
