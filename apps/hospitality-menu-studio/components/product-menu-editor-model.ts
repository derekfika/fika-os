import type { ProductMenuChoices, ProductMenuConfiguration } from "../../shared/hospitality-menu-studio-product-content";

export function menuChoiceReferences(choices: ProductMenuChoices) {
  return [...choices.dishes, ...choices.groups.flatMap(group => group.dishes)];
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
