import type { StudioChoiceGroup, StudioChoicePresentation, StudioPortalChoices } from "./hospitality-menu-studio-selection";

export const flatStudioChoiceGroupId = "studio-flat";

type ChoiceControlProps = {
  label: string;
  presentation: StudioChoicePresentation;
  dishes: StudioPortalChoices["dishes"];
  groups?: StudioChoiceGroup[];
  quantities: Readonly<Record<string, number>>;
  dropdownChoices?: Readonly<Record<string, string>>;
  onDropdownChange?: (groupId: string, dishId: string) => void;
  onQuantityChange?: (dishId: string, quantity: number) => void;
  fieldClassName?: string;
  rowClassName?: string;
};

/** Apps supply their own React factory so this neutral shared renderer has no cross-app runtime dependency. */
export function renderStudioDishChoiceControls<T>(h: (type: string, props: Record<string, unknown> | null, ...children: any[]) => T, props: ChoiceControlProps): T[] {
  const dishes = new Map(props.dishes.map(dish => [dish.id, dish]));
  const sets = props.groups?.length ? props.groups : [{ id: flatStudioChoiceGroupId, name: props.label, presentation: props.presentation, dishIds: props.dishes.map(dish => dish.id) }];
  const quantity = (value: string) => { const parsed = Number(value); return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0; };
  return sets.map(set => {
    const options = set.dishIds.map(id => dishes.get(id)).filter((dish): dish is StudioPortalChoices["dishes"][number] => Boolean(dish));
    const selected = options.find(dish => dish.id === props.dropdownChoices?.[set.id]);
    const choice = set.presentation === "dropdown" ? [
      h("label", null, "Dish", h("select", { value: selected?.id ?? "", disabled: !props.onDropdownChange, onChange: (event: { target: { value: string } }) => props.onDropdownChange?.(set.id, event.target.value) },
        h("option", { value: "" }, "Choose…"), ...options.map(dish => h("option", { key: dish.id, value: dish.id }, dish.name)))),
      selected?.description ? h("p", null, selected.description) : null,
      h("label", null, "Quantity", h("input", { inputMode: "numeric", type: "number", min: 0, step: 1, disabled: !selected || !props.onQuantityChange,
        value: selected ? props.quantities[selected.id] || "" : "", onChange: (event: { target: { value: string } }) => { if (selected) props.onQuantityChange?.(selected.id, quantity(event.target.value)); } })),
    ] : set.presentation === "quantities" ? options.map(dish => h("label", { key: dish.id, className: props.rowClassName },
      h("span", null, h("strong", null, dish.name), dish.description ? h("span", null, dish.description) : null),
      h("input", { "aria-label": `${dish.name} quantity`, inputMode: "numeric", type: "number", min: 0, step: 1, value: props.quantities[dish.id] || "", disabled: !props.onQuantityChange,
        onChange: (event: { target: { value: string } }) => props.onQuantityChange?.(dish.id, quantity(event.target.value)) }))) : [h("p", null, "These selection rules are not available.")];
    return h("fieldset", { key: set.id, className: props.fieldClassName }, h("legend", null, set.name), ...choice);
  });
}
