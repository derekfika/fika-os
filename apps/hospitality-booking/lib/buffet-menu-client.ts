import { z } from "zod";
import type { BuffetMenu, BuffetSelection } from "../app/ui/BuffetMenuDialog";
import type { PortalMenuItem } from "./mnk-contract";

const id = z.string().min(1);
const configSchema = z.object({
  contract: z.literal("fika.hot-fork-buffet-menu.v1"), menuVersion: id,
  readiness: z.object({ customerSubmission: z.boolean(), status: id, pendingRules: z.array(z.string()) }),
  packages: z.array(z.object({ id: z.enum(["gold", "silver"]), canonicalItemIds: z.array(id).min(1), rules: z.object({ mainChoices: z.literal(2), mainMinimumPortions: z.number().int().positive(), mainPortionsMustEqualGuests: z.literal(true), saladChoices: z.number().int().nonnegative(), dessertChoices: z.number().int().nonnegative(), dessertAllocation: z.enum(["equal-split", "unconfirmed"]), dessertMinimumPortions: z.union([z.literal("unconfirmed"), z.number().int().positive()]), oddGuestRounding: z.string() }) })),
  dishes: z.array(z.object({ id, category: z.enum(["meat", "fish", "vegetarian", "vegan", "salad", "dessert"]), name: id, description: z.string().optional(), allergenStatus: z.literal("unrecorded"), dietaryStatus: z.literal("unrecorded"), selectionStatus: z.enum(["source_listed", "review_required"]) })),
});
export type BuffetConfig = z.infer<typeof configSchema>;
export type BuffetPreview = { menuVersion: string; selection: BuffetSelection; dessertPortions: Record<string, number | null> };
const previewSchema = z.object({ menuVersion: id, selection: z.object({ packageId: id, nonVegetarianMainId: id, vegetarianMainId: id, mainPortions: z.record(z.string(), z.number().int().nonnegative()), saladIds: z.array(id), dessertIds: z.array(id) }), dessertPortions: z.record(z.string(), z.number().int().positive().nullable()) });
export function parseBuffetPreview(value: unknown): BuffetPreview | undefined { const parsed = previewSchema.safeParse(value); return parsed.success ? parsed.data : undefined; }

export async function loadBuffetConfig(signal?: AbortSignal): Promise<BuffetConfig> {
  const response = await fetch("/api/hospitality-buffet-selection", { cache: "no-store", signal });
  if (!response.ok) throw new Error("The buffet menu is unavailable. Please try again.");
  const parsed = configSchema.safeParse(await response.json());
  if (!parsed.success) throw new Error("The buffet menu could not be verified. Please try again.");
  return parsed.data;
}
export function buffetPackageForItem(config: BuffetConfig, itemId: string) { return config.packages.find(pkg => pkg.canonicalItemIds.includes(itemId)); }
export function buffetMenuView(config: BuffetConfig, catalogue: readonly PortalMenuItem[], selectedItemIds: readonly string[], currentItemId: string): BuffetMenu {
  const packages = config.packages.flatMap(pkg => {
    const item = catalogue.find(candidate => pkg.canonicalItemIds.includes(candidate.id));
    if (!item || (item.id !== currentItemId && selectedItemIds.includes(item.id))) return [];
    return [{ id: pkg.id, label: `${pkg.id === "gold" ? "Gold" : "Silver"} · £${item.unitPrice.toFixed(2)} per guest excluding VAT`, saladCount: pkg.rules.saladChoices, dessertCount: pkg.rules.dessertChoices, mainMinimumPortions: pkg.rules.mainMinimumPortions, ...(typeof pkg.rules.dessertMinimumPortions === "number" ? { dessertMinimumPortions: pkg.rules.dessertMinimumPortions } : {}), dessertAllocation: pkg.rules.dessertAllocation, orderingReady: config.readiness.customerSubmission, pendingRules: config.readiness.pendingRules }];
  });
  return { version: config.menuVersion, packages, dishes: config.dishes.map(dish => ({ ...dish, selectionStatus: dish.selectionStatus === "review_required" ? "review_required" : "eligible" })) };
}
export function buffetChoice(preview: BuffetPreview) {
  const s = preview.selection;
  return { id: "hot-fork-buffet-selection", value: { contract: "fika.hot-fork-buffet-selection.v1", menuVersion: preview.menuVersion, packageId: s.packageId, mains: [s.nonVegetarianMainId, s.vegetarianMainId].map(dishId => ({ dishId, portions: s.mainPortions[dishId] })), saladIds: s.saladIds, desserts: s.dessertIds.map(dishId => ({ dishId, portions: preview.dessertPortions?.[dishId] ?? null })) } };
}

/** A saved preview cannot cross the booking boundary until its exact menu and rules are approved. */
export function buffetPreviewIssue(lines: readonly { quantity: number; buffetPreview?: BuffetPreview }[], guestCount: number, config?: BuffetConfig): string | undefined {
  for (const line of lines) {
    if (!line.buffetPreview) continue;
    const preview = parseBuffetPreview(line.buffetPreview);
    if (!preview) return "The saved buffet selection needs to be reviewed before sending.";
    if (!config || !config.readiness.customerSubmission || preview.menuVersion !== config.menuVersion) return "This buffet menu is a preview. Remove it or wait for the package rules to be confirmed before sending.";
    const selection = preview.selection;
    if (line.quantity !== guestCount || (selection.mainPortions[selection.nonVegetarianMainId] || 0) + (selection.mainPortions[selection.vegetarianMainId] || 0) !== guestCount) return "The buffet menu needs to be reviewed for the current guest count.";
  }
  return undefined;
}
