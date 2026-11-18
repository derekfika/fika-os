import assert from "node:assert/strict";
import test from "node:test";
import type { Menu, Section } from "../lib/contract";
import { compareMenuDrafts } from "../lib/versions";

test("saved structural comparison distinguishes section, mapping and independent week edits", () => {
  const rotating: Section = {
    id: "bowl-food", name: "Bowl food", mode: "rotation", catalogueItemId: "bowls-a", staticDishIds: [],
    weeks: [["choice-a"], ["choice-b", "choice-c"], [], [], [], []],
  };
  const second: Section = { ...rotating, id: "canapes", name: "Canapés", catalogueItemId: "", mode: "static" };
  const before: Menu = {
    id: "test-menu", name: "Sample season", kind: "seasonal", version: 1, updatedAt: "",
    startDate: "2026-11-30", endDate: "2027-02-28", anchorMonday: "2026-11-30",
    sections: [rotating, second],
  };
  const after: Menu = {
    ...before, version: 2,
    sections: [second, { ...rotating, catalogueItemId: "bowls-b", weeks: [rotating.weeks[0], ["choice-c", "choice-b"], [], [], [], []] }],
  };
  assert.deepEqual(compareMenuDrafts(before, after), [
    "Bowl food catalogue mapping changed.",
    "Bowl food Week 2 dish choices or order changed.",
    "Section order changed.",
  ]);
  assert.deepEqual(compareMenuDrafts(before, { ...before, version: 3 }), []);
});
