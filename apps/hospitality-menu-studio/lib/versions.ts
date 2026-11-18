import { isDeepStrictEqual } from "node:util";
import type { Menu } from "./contract";

export function compareMenuDrafts(before: Menu, after: Menu): string[] {
  const changes: string[] = [];
  if (before.name !== after.name) changes.push("Menu name changed.");
  if (before.kind !== after.kind) changes.push("Menu type changed.");
  if (before.startDate !== after.startDate || before.endDate !== after.endDate) changes.push("Menu dates changed.");
  if (before.anchorMonday !== after.anchorMonday) changes.push("Rotation anchor changed.");
  const current = new Map(after.sections.map(section => [section.id, section]));
  const earlier = new Map(before.sections.map(section => [section.id, section]));
  for (const previous of before.sections) {
    const section = current.get(previous.id);
    if (!section) { changes.push(`${previous.name || "Unnamed section"} was removed.`); continue; }
    const label = section.name || "Unnamed section";
    if (previous.name !== section.name) changes.push(`${previous.name || "Unnamed section"} was renamed to ${label}.`);
    if (previous.catalogueItemId !== section.catalogueItemId) changes.push(`${label} catalogue mapping changed.`);
    if (previous.mode !== section.mode) changes.push(`${label} availability mode changed.`);
    if (!isDeepStrictEqual(previous.staticDishIds, section.staticDishIds)) changes.push(`${label} all-season dish choices or order changed.`);
    for (const [index, choices] of section.weeks.entries()) {
      if (!isDeepStrictEqual(previous.weeks[index], choices)) changes.push(`${label} Week ${index + 1} dish choices or order changed.`);
    }
  }
  for (const section of after.sections) {
    if (!earlier.has(section.id)) changes.push(`${section.name || "Unnamed section"} was added.`);
  }
  if (!isDeepStrictEqual(
    before.sections.filter(section => current.has(section.id)).map(section => section.id),
    after.sections.filter(section => earlier.has(section.id)).map(section => section.id),
  )) changes.push("Section order changed.");
  return changes;
}
