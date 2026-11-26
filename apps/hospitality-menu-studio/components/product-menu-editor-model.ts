import { productMenuSetup, type ProductMenuChoices, type ProductMenuConfiguration } from "../../shared/hospitality-menu-studio-product-content";

type DishReference = ProductMenuChoices["dishes"][number];
type LostWeek = { weekIndex: number; dishCount: number };
type Invalid = { status: "invalid"; message: string };
type Confirmation = { status: "confirmation-required"; lostWeeks: LostWeek[] };
type Applied = { status: "applied"; configuration: ProductMenuConfiguration };
type RotationTarget = { kind: "rotation"; anchorMonday: string; cycleWeeks: number; weekIndex?: number };
type ReconfigureTarget = RotationTarget | { kind: "fixed"; weekIndex: number };
type ReconfigureResult = Invalid | Confirmation | (Applied & { weekIndex: number });
type CopyResult = Invalid | Confirmation | Applied;

const emptyChoices = (): ProductMenuChoices => ({ dishes: [], groups: [] });
const invalid = (message: string): Invalid => ({ status: "invalid", message });
const validIndex = (index: number, length: number) => Number.isInteger(index) && index >= 0 && index < length;
const weekLoss = (weekIndex: number, choices: ProductMenuChoices): LostWeek =>
  ({ weekIndex, dishCount: menuChoiceReferences(choices).length });

export function menuChoiceReferences(choices: ProductMenuChoices) {
  return [...choices.dishes, ...choices.groups.flatMap(group => group.dishes)];
}

/** Indices refer to the editor's zero-based weeks. Confirmations describe the latest configuration passed in. */
export function reconfigureProductMenu(
  configuration: ProductMenuConfiguration,
  target: ReconfigureTarget,
  confirmedLoss = false,
): ReconfigureResult {
  const { schedule } = configuration;
  if (target.kind === "fixed") {
    if (schedule.kind === "fixed") return { status: "applied", configuration, weekIndex: 0 };
    if (!validIndex(target.weekIndex, schedule.weeks.length)) return invalid("Choose a week to keep in the fixed menu.");
    if (!confirmedLoss) {
      return {
        status: "confirmation-required",
        lostWeeks: schedule.weeks.map((week, index) => weekLoss(index, week)).filter(week => week.weekIndex !== target.weekIndex),
      };
    }
    return {
      status: "applied", weekIndex: 0,
      configuration: { ...configuration, schedule: { kind: "fixed", choices: schedule.weeks[target.weekIndex] } },
    };
  }

  const { anchorMonday, cycleWeeks } = target;
  const setup = productMenuSetup.safeParse({ kind: "rotation", anchorMonday, cycleWeeks });
  if (!setup.success) return invalid(setup.error.issues[0]?.message ?? "Choose a valid rotation start and number of weeks.");
  const existing = schedule.kind === "fixed" ? [schedule.choices] : schedule.weeks;
  const desiredIndex = target.weekIndex ?? 0;
  const weekIndex = Number.isInteger(desiredIndex) ? Math.max(0, Math.min(desiredIndex, cycleWeeks - 1)) : 0;
  if (existing.length > cycleWeeks && !confirmedLoss) {
    return { status: "confirmation-required", lostWeeks: existing.slice(cycleWeeks).map((week, index) => weekLoss(cycleWeeks + index, week)) };
  }
  if (schedule.kind === "rotation" && schedule.weeks.length === cycleWeeks && schedule.anchorMonday === anchorMonday) {
    return { status: "applied", configuration, weekIndex };
  }
  const weeks = Array.from({ length: cycleWeeks }, (_, index) => existing[index] ?? emptyChoices());
  return { status: "applied", configuration: { ...configuration, schedule: { kind: "rotation", anchorMonday, weeks } }, weekIndex };
}

function appendChoices(destination: ProductMenuChoices, source: ProductMenuChoices): ProductMenuChoices {
  // A dish is unique across the whole week. Keep the destination's existing revision and position.
  const assigned = new Set(menuChoiceReferences(destination).map(dish => dish.dishId));
  const additions = (references: DishReference[]) => references.filter(reference => {
    if (assigned.has(reference.dishId)) return false;
    assigned.add(reference.dishId);
    return true;
  });
  const dishes = [...destination.dishes, ...additions(source.dishes)];
  const groups = new Map(destination.groups.map(group => [group.groupId, group]));
  let changed = dishes.length !== destination.dishes.length;
  for (const group of source.groups) {
    const added = additions(group.dishes);
    if (!added.length) continue;
    changed = true;
    const previous = groups.get(group.groupId);
    groups.set(group.groupId, { groupId: group.groupId, dishes: [...(previous?.dishes ?? []), ...added] });
  }
  return changed ? { dishes, groups: [...groups.values()] } : destination;
}

export function copyProductMenuWeeks(
  configuration: ProductMenuConfiguration,
  copy: { sourceWeek: number; targetWeeks: readonly number[]; mode: "append" | "replace"; confirmedReplace?: boolean },
): CopyResult {
  const { schedule } = configuration;
  if (schedule.kind !== "rotation") return invalid("Week copying is available for rotating menus.");
  if (!validIndex(copy.sourceWeek, schedule.weeks.length)) return invalid("Choose a source week from this rotation.");
  const targets = new Set(copy.targetWeeks);
  if (!targets.size || [...targets].some(week => !validIndex(week, schedule.weeks.length) || week === copy.sourceWeek)) {
    return invalid("Choose one or more other weeks from this rotation.");
  }
  const source = schedule.weeks[copy.sourceWeek];
  if (copy.mode === "replace" && !copy.confirmedReplace) {
    const lostWeeks = schedule.weeks.flatMap((week, index) => {
      const loss = weekLoss(index, week);
      return targets.has(index) && loss.dishCount && JSON.stringify(week) !== JSON.stringify(source) ? [loss] : [];
    });
    if (lostWeeks.length) return { status: "confirmation-required", lostWeeks };
  }
  const weeks = schedule.weeks.map((week, index) => {
    if (!targets.has(index)) return week;
    if (copy.mode === "append") return appendChoices(week, source);
    return JSON.stringify(week) === JSON.stringify(source) ? week : structuredClone(source);
  });
  const updated = weeks.some((week, index) => week !== schedule.weeks[index]);
  return { status: "applied", configuration: updated ? { ...configuration, schedule: { ...schedule, weeks } } : configuration };
}

export function moveProductMenuDish(
  configuration: ProductMenuConfiguration,
  move: { weekIndex: number; dishId: string; toGroupId?: string; toIndex: number },
): Invalid | Applied {
  const { schedule } = configuration;
  const slot = schedule.kind === "fixed" ? (move.weekIndex === 0 ? schedule.choices : undefined) : schedule.weeks[move.weekIndex];
  if (!slot) return invalid("Choose a valid week.");
  const fromGroup = slot.groups.find(group => group.dishes.some(dish => dish.dishId === move.dishId));
  const targetGroup = slot.groups.find(group => group.groupId === move.toGroupId);
  const grouped = configuration.groups.length > 0;
  if (grouped ? !configuration.groups.some(group => group.id === move.toGroupId) : move.toGroupId !== undefined) {
    return invalid("Choose a destination in this menu.");
  }
  const source = grouped ? fromGroup?.dishes ?? [] : slot.dishes;
  const destination = grouped ? targetGroup?.dishes ?? [] : slot.dishes;
  const fromIndex = source.findIndex(dish => dish.dishId === move.dishId);
  if (fromIndex < 0) return invalid("The dish is no longer assigned to this week.");
  const sameLocation = source === destination;
  if (!validIndex(move.toIndex, destination.length + (sameLocation ? 0 : 1))) return invalid("Choose a valid dish position.");
  if (sameLocation && fromIndex === move.toIndex) return { status: "applied", configuration };
  const remaining = source.filter((_, index) => index !== fromIndex);
  const inserted = [...(sameLocation ? remaining : destination)];
  inserted.splice(move.toIndex, 0, source[fromIndex]);
  let choices: ProductMenuChoices = { ...slot, dishes: inserted };
  if (grouped) {
    const groups = slot.groups.map(group => group.groupId === move.toGroupId ? { ...group, dishes: inserted }
      : group === fromGroup ? { ...group, dishes: remaining } : group);
    if (!targetGroup && move.toGroupId) groups.push({ groupId: move.toGroupId, dishes: inserted });
    choices = { ...slot, groups };
  }
  return {
    status: "applied",
    configuration: { ...configuration, schedule: schedule.kind === "fixed" ? { ...schedule, choices }
      : { ...schedule, weeks: schedule.weeks.map((week, index) => index === move.weekIndex ? choices : week) } },
  };
}

export function removeProductMenuGroup(configuration: ProductMenuConfiguration, groupId: string): ProductMenuConfiguration {
  const groups = configuration.groups.filter(group => group.id !== groupId);
  if (groups.length === configuration.groups.length) return configuration;
  const nextGroupId = groups[0]?.id;

  function removeFromSlot(slot: ProductMenuChoices): ProductMenuChoices {
    const kept = slot.groups.filter(group => group.groupId !== groupId);
    const removedDishes = slot.groups.find(group => group.groupId === groupId)?.dishes ?? [];
    if (!nextGroupId) return { dishes: [...slot.dishes, ...removedDishes], groups: [] };
    if (!removedDishes.length) return { ...slot, groups: kept };
    const existing = kept.find(group => group.groupId === nextGroupId);
    const merged = { groupId: nextGroupId, dishes: [...(existing?.dishes ?? []), ...removedDishes] };
    return { ...slot, groups: existing ? kept.map(group => group.groupId === nextGroupId ? merged : group) : [...kept, merged] };
  }

  const { schedule } = configuration;
  return {
    ...configuration, groups,
    schedule: schedule.kind === "fixed"
      ? { ...schedule, choices: removeFromSlot(schedule.choices) }
      : { ...schedule, weeks: schedule.weeks.map(removeFromSlot) },
  };
}
