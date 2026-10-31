import type { RotationWorkspace } from "./rotations-ui-types";
import { INITIAL_ROTATION_CATEGORIES, INITIAL_ROTATION_CYCLE_WEEKS, ROTATIONS_SCHEMA, type RotationConfiguration, type RotationHead } from "../../shared/hospitality-rotations";

export type RotationOption = { id: string; name: string; category: string; revision?: number };

/** Build a real first draft only after the manager has selected canonical records. */
export function initialRotationConfiguration(input: {
  label: string;
  anchorMonday: string;
  groupLabel: string;
  categoryId: string;
  itemId: string;
  dishes: RotationOption[];
}): RotationConfiguration {
  const bank = input.dishes.map((dish) => ({ dishId: dish.id, recipeRevision: dish.revision || 1 }));
  const firstDish = bank[0]?.dishId;
  return {
    schema: ROTATIONS_SCHEMA,
    label: input.label.trim(),
    calendar: { anchorMonday: input.anchorMonday, cycleWeeks: INITIAL_ROTATION_CYCLE_WEEKS, timeZone: "Europe/London" },
    categories: INITIAL_ROTATION_CATEGORIES.map((category) => ({ ...category })),
    groups: [{
      id: crypto.randomUUID(), label: input.groupLabel.trim(), categoryId: input.categoryId, itemId: input.itemId,
      dishBank: bank,
      weeks: Array.from({ length: INITIAL_ROTATION_CYCLE_WEEKS }, (_, index) => ({ week: index + 1, dishIds: firstDish ? [firstDish] : [] })),
      rules: { guests: { minimum: 6, maximum: 120, increment: 1 }, distinctDishes: { minimum: 1, maximum: 3 }, quantityPerDish: { minimum: 6, maximum: 60, increment: 6 }, unit: "pieces" },
    }],
  };
}

export function rotationActivationStatus(head: RotationHead, revision: number, today: string) {
  const activation = head.activations.find((item) => item.revision === revision);
  if (!activation) return "Unknown";
  if (activation.effectiveFrom > today) return "Scheduled";
  const current = [...head.activations].filter((item) => item.effectiveFrom <= today).sort((left, right) => right.effectiveFrom.localeCompare(left.effectiveFrom))[0];
  return current?.revision === revision ? "Active" : "Historical";
}

export function rotationWeekForDate(date: string, anchorDate: string, cycleLength: number): number {
  const dayMs = 86_400_000;
  const dateAtUtc = Date.parse(`${date}T00:00:00Z`);
  const anchorAtUtc = Date.parse(`${anchorDate}T00:00:00Z`);
  if (!Number.isFinite(dateAtUtc) || !Number.isFinite(anchorAtUtc) || cycleLength < 1) return 1;
  const days = Math.floor((dateAtUtc - anchorAtUtc) / dayMs);
  return ((Math.floor(days / 7) % cycleLength) + cycleLength) % cycleLength + 1;
}

export function versionForDate(workspace: RotationWorkspace, date: string) {
  return [...workspace.versions]
    .filter((version) => version.status !== "draft" && version.effectiveFrom <= date)
    .sort((left, right) => right.effectiveFrom.localeCompare(left.effectiveFrom) || right.revision - left.revision)[0];
}

export function moveDish(
  weeklySelections: RotationWorkspace["versions"][number]["weeklySelections"],
  groupId: string,
  sourceWeek: number,
  sourceIndex: number,
  targetWeek: number,
  targetIndex: number,
) {
  const next = structuredClone(weeklySelections);
  const source = next[groupId]?.[sourceWeek];
  const target = next[groupId]?.[targetWeek];
  if (!source || !target || sourceIndex < 0 || sourceIndex >= source.length || targetIndex < 0 || targetIndex > target.length) return next;
  const [dishId] = source.splice(sourceIndex, 1);
  if (dishId) target.splice(targetIndex, 0, dishId);
  return next;
}

export function copyDish(
  weeklySelections: RotationWorkspace["versions"][number]["weeklySelections"],
  groupId: string,
  sourceWeek: number,
  sourceIndex: number,
  targetWeek: number,
  targetIndex: number,
) {
  const next = structuredClone(weeklySelections);
  const dishId = next[groupId]?.[sourceWeek]?.[sourceIndex];
  const target = next[groupId]?.[targetWeek];
  if (dishId && target && targetIndex >= 0 && targetIndex <= target.length) target.splice(targetIndex, 0, dishId);
  return next;
}

export function compareVersions(workspace: RotationWorkspace, leftId: string, rightId: string) {
  const left = workspace.versions.find((version) => version.id === leftId);
  const right = workspace.versions.find((version) => version.id === rightId);
  if (!left || !right) return [];
  const differences: Array<{ groupId: string; groupLabel: string; field: string; left: string; right: string }> = [];
  for (const group of workspace.groups) {
    const leftGroupWeeks = left.weeklySelections[group.id] ?? {};
    const rightGroupWeeks = right.weeklySelections[group.id] ?? {};
    for (let week = 1; week <= workspace.globalCycle.lengthWeeks; week += 1) {
      const leftDishes = leftGroupWeeks[week] ?? [];
      const rightDishes = rightGroupWeeks[week] ?? [];
      if (leftDishes.join("\u0000") !== rightDishes.join("\u0000")) differences.push({
        groupId: group.id,
        groupLabel: group.name,
        field: `Week ${week}`,
        left: leftDishes.join(", ") || "No dishes",
        right: rightDishes.join(", ") || "No dishes",
      });
    }
  }
  return differences;
}
