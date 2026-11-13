import { HOT_FORK_BUFFET_CHOICE_ID, HOT_FORK_BUFFET_MENU_VERSION, HotForkBuffetChoiceSchema, hotForkBuffetDish } from "@fika/server-shared/hospitality-buffet-selection";
import { formatCatalogueChoices } from "@fika/server-shared/hospitality-effective-offering";

export function isBuffetChoice(value: unknown): boolean {
  return Boolean(value && typeof value === "object" && (value as { id?: unknown }).id === HOT_FORK_BUFFET_CHOICE_ID);
}

/** Booking evidence only: CPU still confirms operational quantities in its existing planner. */
export default function BuffetOrderChoice({ choices }: { choices: readonly unknown[] }) {
  const buffetChoices = choices.filter(isBuffetChoice);
  if (!buffetChoices.length) return null;
  if (buffetChoices.length !== 1) return <small role="status">Buffet menu selection needs review: duplicate choice evidence.</small>;
  const parsed = HotForkBuffetChoiceSchema.safeParse(buffetChoices[0]);
  if (!parsed.success) return <small role="status">Buffet menu selection needs review: stored choice is invalid.</small>;
  const selection = parsed.data.value;
  const current = selection.menuVersion === HOT_FORK_BUFFET_MENU_VERSION;
  const dishName = (id: string) => current ? hotForkBuffetDish(id)?.name || id : id;
  const mains = selection.mains.map(main => `${main.portions} × ${dishName(main.dishId)}`).join("; ");
  const salads = selection.saladIds.map(dishName).join("; ");
  const desserts = selection.desserts.map(dessert => `${dishName(dessert.dishId)} · ${dessert.portions === null ? "portions to confirm" : `${dessert.portions} portions`}`).join("; ");
  return <>
    <small>Selected Hot Fork Buffet {selection.packageId} menu · version {selection.menuVersion}</small>
    <small>Main choices: {mains}</small>
    <small>Salad choices (portions to confirm): {salads}</small>
    <small>Dessert choices: {desserts}</small>
    {!current && <small role="status">Historical menu names need review against the original version.</small>}
    <small>Dish allergen and dietary information is unrecorded; verify before production.</small>
  </>;
}

export function ProductionOrderChoices({ choices }: { choices?: readonly unknown[] }) {
  if (!choices?.length) return null;
  const ordinaryChoices = choices.filter(choice => !isBuffetChoice(choice));
  return <>
    <BuffetOrderChoice choices={choices} />
    {ordinaryChoices.length ? <small>{formatCatalogueChoices(ordinaryChoices).join(" · ")}</small> : null}
  </>;
}
