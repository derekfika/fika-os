import type { RotationWorkspace } from "./rotations-ui-types";

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
