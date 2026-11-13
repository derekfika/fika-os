import { z } from "zod";
import type { BuffetMenu, BuffetSelection } from "../app/ui/BuffetMenuDialog";
import type { PortalMenuItem } from "./mnk-contract";

const id = z.string().min(1);
const configSchema = z.object({
  contract: z.literal("fika.hot-fork-buffet-menu.v1"), menuVersion: id, rulesVersion: id,
  readiness: z.object({ customerSubmission: z.boolean(), stagingCustomerSubmission: z.boolean(), status: z.literal("rules_confirmed"), pendingRules: z.array(z.string()), liveOrderingApprovalRequired: z.boolean() }),
  packages: z.array(z.object({ id: z.enum(["gold", "silver"]), canonicalItemIds: z.array(id).min(1), rules: z.object({ mainChoices: z.literal(2), mainMinimumPortions: z.number().int().positive(), mainPortionsMustEqualGuests: z.literal(true), saladChoices: z.number().int().nonnegative(), dessertChoices: z.number().int().nonnegative(), saladAllocation: z.literal("chef-discretion"), dessertAllocation: z.literal("chef-discretion"), dessertMinimumPortions: z.null(), dessertIntent: z.enum(["equal-split", "one-choice"]), sides: z.literal("included-in-mains"), dietaryPortions: z.literal("within-guest-count") }) })),
  dishes: z.array(z.object({ id, category: z.enum(["meat", "fish", "vegetarian", "vegan", "salad", "dessert"]), name: id, description: z.string().optional(), allergenStatus: z.literal("unrecorded"), dietaryStatus: z.literal("unrecorded"), selectionStatus: z.enum(["source_listed", "review_required"]) })),
});
export type BuffetConfig = z.infer<typeof configSchema>;
export type BuffetPreview = { menuVersion: string; rulesVersion?: string; selection: BuffetSelection };
const previewSchema = z.object({ menuVersion: id, rulesVersion: id.optional(), selection: z.object({ packageId: id, nonVegetarianMainId: id, vegetarianMainId: id, mainPortions: z.record(z.string(), z.number().int().nonnegative()), saladIds: z.array(id), dessertIds: z.array(id) }) });
export function parseBuffetPreview(value: unknown): BuffetPreview | undefined { const parsed = previewSchema.safeParse(value); return parsed.success ? parsed.data : undefined; }

export async function loadBuffetConfig(signal?: AbortSignal): Promise<BuffetConfig> {
  const response = await fetch("/api/hospitality-buffet-selection", { cache: "no-store", signal });
  if (!response.ok) throw new Error("The buffet menu is unavailable. Please try again.");
  const parsed = configSchema.safeParse(await response.json());
  if (!parsed.success) throw new Error("The buffet menu could not be verified. Please try again.");
  return parsed.data;
}
export function buffetSubmissionEnabled(config: BuffetConfig) { return config.readiness.stagingCustomerSubmission || (config.readiness.customerSubmission && !config.readiness.liveOrderingApprovalRequired); }
export function buffetPackageForItem(config: BuffetConfig, itemId: string) { return config.packages.find(pkg => pkg.canonicalItemIds.includes(itemId)); }
export function buffetMenuView(config: BuffetConfig, catalogue: readonly PortalMenuItem[], selectedItemIds: readonly string[], currentItemId: string): BuffetMenu {
  const packages = config.packages.flatMap(pkg => {
    const item = catalogue.find(candidate => pkg.canonicalItemIds.includes(candidate.id));
    if (!item || (item.id !== currentItemId && selectedItemIds.includes(item.id))) return [];
    return [{ id: pkg.id, label: `${pkg.id === "gold" ? "Gold" : "Silver"} · £${item.unitPrice.toFixed(2)} per guest excluding VAT`, saladCount: pkg.rules.saladChoices, dessertCount: pkg.rules.dessertChoices, mainMinimumPortions: pkg.rules.mainMinimumPortions, dessertIntent: pkg.rules.dessertIntent, orderingReady: buffetSubmissionEnabled(config), pendingRules: config.readiness.pendingRules }];
  });
  return { version: config.menuVersion, packages, dishes: config.dishes.map(dish => ({ ...dish, selectionStatus: dish.selectionStatus === "review_required" ? "review_required" : "eligible" })) };
}
export function buffetChoice(preview: BuffetPreview) {
  const s = preview.selection;
  return { id: "hot-fork-buffet-selection", value: { contract: "fika.hot-fork-buffet-selection.v2", menuVersion: preview.menuVersion, rulesVersion: preview.rulesVersion, packageId: s.packageId, mains: [s.nonVegetarianMainId, s.vegetarianMainId].map(dishId => ({ dishId, portions: s.mainPortions[dishId] })), saladIds: s.saladIds, dessertIds: s.dessertIds } };
}

/** A saved preview cannot cross the booking boundary until its exact menu and rules are approved. */
export function buffetPreviewIssue(lines: readonly { quantity: number; buffetPreview?: BuffetPreview }[], guestCount: number, config?: BuffetConfig): string | undefined {
  for (const line of lines) {
    if (!line.buffetPreview) continue;
    const preview = parseBuffetPreview(line.buffetPreview);
    if (!preview) return "The saved buffet selection needs to be reviewed before sending.";
    if (!config || preview.menuVersion !== config.menuVersion || preview.rulesVersion !== config.rulesVersion) return "The saved buffet selection needs to be reviewed and saved again before sending.";
    if (!buffetSubmissionEnabled(config)) return "This buffet menu is a preview. Remove it or wait for live ordering approval before sending.";
    const selection = preview.selection;
    if (line.quantity !== guestCount || (selection.mainPortions[selection.nonVegetarianMainId] || 0) + (selection.mainPortions[selection.vegetarianMainId] || 0) !== guestCount) return "The buffet menu needs to be reviewed for the current guest count.";
  }
  return undefined;
}
