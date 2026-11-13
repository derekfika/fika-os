import { z } from "zod";
import source from "./hospitality-buffet-menu.v1.json";

export const HOT_FORK_BUFFET_CHOICE_ID = "hot-fork-buffet-selection";
export const HOT_FORK_BUFFET_SELECTION_CONTRACT = "fika.hot-fork-buffet-selection.v1";
export const HOT_FORK_BUFFET_MENU_CONTRACT = "fika.hot-fork-buffet-menu.v1";
export const HOT_FORK_BUFFET_MENU_VERSION = source.version;

export type BuffetCategory = "meat" | "fish" | "vegetarian" | "vegan" | "salad" | "dessert";
export type BuffetDish = {
  id: string;
  category: BuffetCategory;
  name: string;
  allergenStatus: "unrecorded";
  dietaryStatus: "unrecorded";
  selectionStatus: "source_listed" | "review_required";
};
export type BuffetPackageId = "gold" | "silver";
export type BuffetSelection = {
  contract: typeof HOT_FORK_BUFFET_SELECTION_CONTRACT;
  menuVersion: string;
  packageId: BuffetPackageId;
  mains: [{ dishId: string; portions: number }, { dishId: string; portions: number }];
  saladIds: [string, string, string];
  desserts: Array<{ dishId: string; portions: number | null }>;
};
export type BuffetChoice = { id: typeof HOT_FORK_BUFFET_CHOICE_ID; value: BuffetSelection };

const menuDishes = source.dishes as BuffetDish[];
const dishById = new Map(menuDishes.map(dish => [dish.id, dish]));
if (source.contract !== HOT_FORK_BUFFET_MENU_CONTRACT || menuDishes.length !== 44 || dishById.size !== 44) {
  throw new Error("The Sam Hot Fork Buffet source menu is incomplete or duplicated.");
}

const packageItems = {
  gold: {
    id: "gold",
    catalogueItemIds: { rcoa: "hospitality-menu-item:rcoa:hot_fork_buffet_gold", mnk: "hospitality-menu-item:mnk:hot_fork_buffet_gold" },
    canonicalItemIds: ["hospitality-menu-item:rcoa:hot_fork_buffet_gold", "hospitality-menu-item:mnk:hot_fork_buffet_gold"],
    rules: { mainChoices: 2, mainMinimumPortions: 12, mainPortionsMustEqualGuests: true, saladChoices: 3, dessertChoices: 2, dessertAllocation: "equal-split", dessertMinimumPortions: "unconfirmed", oddGuestRounding: "unconfirmed" },
  },
  silver: {
    id: "silver",
    catalogueItemIds: { rcoa: "hospitality-menu-item:rcoa:hot_fork_buffet_silver", mnk: "hospitality-menu-item:mnk:hot_fork_buffet_silver" },
    canonicalItemIds: ["hospitality-menu-item:rcoa:hot_fork_buffet_silver", "hospitality-menu-item:mnk:hot_fork_buffet_silver"],
    rules: { mainChoices: 2, mainMinimumPortions: 12, mainPortionsMustEqualGuests: true, saladChoices: 3, dessertChoices: 1, dessertAllocation: "unconfirmed", dessertMinimumPortions: "unconfirmed", oddGuestRounding: "not_applicable" },
  },
} as const;

/**
 * The approved source supplies dish names and category headings, not verified allergen or
 * dietary declarations. Feta appears under its Vegan heading; it is retained as source
 * evidence but needs review before it can be selected as a vegan main.
 */
export const hotForkBuffetMenu = {
  contract: HOT_FORK_BUFFET_MENU_CONTRACT,
  menuVersion: HOT_FORK_BUFFET_MENU_VERSION,
  source: { documentUrl: source.source.documentUrl, revisionId: source.source.revisionId, dishCount: 44 },
  readiness: {
    customerSubmission: false,
    status: "pending_rules",
    pendingRules: [
      "Salad portions and production conversion",
      "Gold dessert rounding for odd guest counts",
      "Dessert minimum portion application",
      "Silver dessert portion allocation",
    ],
  },
  packages: [packageItems.gold, packageItems.silver],
  dishes: menuDishes,
} as const;

/** Transport accepts historical versions for exact idempotent replay; writes validate the current version below. */
export const HotForkBuffetTransportSelectionSchema = z.object({
  contract: z.literal(HOT_FORK_BUFFET_SELECTION_CONTRACT),
  menuVersion: z.string().trim().min(1).max(100),
  packageId: z.enum(["gold", "silver"]),
  mains: z.tuple([
    z.object({ dishId: z.string(), portions: z.number().int().positive() }).strict(),
    z.object({ dishId: z.string(), portions: z.number().int().positive() }).strict(),
  ]),
  saladIds: z.tuple([z.string(), z.string(), z.string()]),
  desserts: z.array(z.object({ dishId: z.string(), portions: z.number().int().positive().nullable() }).strict()).min(1).max(2),
}).strict();
export const HotForkBuffetSelectionSchema = HotForkBuffetTransportSelectionSchema.extend({ menuVersion: z.literal(HOT_FORK_BUFFET_MENU_VERSION) });
export const HotForkBuffetChoiceSchema = z.object({
  id: z.literal(HOT_FORK_BUFFET_CHOICE_ID),
  value: HotForkBuffetTransportSelectionSchema,
}).strict();

const invalid = (message: string): never => { throw Object.assign(new Error(message), { status: 422 }); };
export function buffetPackageForItem(itemId: string): BuffetPackageId | undefined {
  const item = itemId.toLowerCase();
  if (item === "hot_fork_buffet_gold" || item === packageItems.gold.catalogueItemIds.rcoa || item === packageItems.gold.catalogueItemIds.mnk) return "gold";
  if (item === "hot_fork_buffet_silver" || item === packageItems.silver.catalogueItemIds.rcoa || item === packageItems.silver.catalogueItemIds.mnk) return "silver";
  return undefined;
}

/** Validate the confirmed selection constraints without implying that pending rules are approved. */
export function validateHotForkBuffetDraft(raw: unknown, itemId: string, guestCount: number): BuffetSelection {
  const parsed = HotForkBuffetSelectionSchema.safeParse(raw);
  if (!parsed.success) return invalid("The Hot Fork Buffet selection is malformed or from an older menu. Reopen Choose Menu.");
  const selection = parsed.data as BuffetSelection;
  const expectedPackage = buffetPackageForItem(itemId);
  if (!expectedPackage || expectedPackage !== selection.packageId) return invalid("The selected buffet package does not match its booking item.");
  if (!Number.isSafeInteger(guestCount) || guestCount < 1) return invalid("Enter a valid guest count for the buffet.");
  const [first, second] = selection.mains;
  const mainDishes = [first, second].map(main => dishById.get(main.dishId));
  if (!mainDishes[0] || !mainDishes[1] || !["meat", "fish"].includes(mainDishes[0].category) || !["vegetarian", "vegan"].includes(mainDishes[1].category)) return invalid("Choose one meat or fish main and one vegetarian or vegan main from Sam's menu.");
  if (mainDishes.some(dish => dish?.selectionStatus !== "source_listed")) return invalid("A selected buffet dish requires dietary review.");
  if (selection.mains.some(main => main.portions < 12)) return invalid("Each selected main requires at least 12 portions.");
  if (first.portions + second.portions !== guestCount) return invalid("Main portions must add up to the guest count.");
  if (new Set(selection.saladIds).size !== 3 || selection.saladIds.some(id => dishById.get(id)?.category !== "salad")) return invalid("Choose exactly three different salads from Sam's menu.");
  const requiredDesserts = selection.packageId === "gold" ? 2 : 1;
  if (selection.desserts.length !== requiredDesserts || new Set(selection.desserts.map(dessert => dessert.dishId)).size !== requiredDesserts || selection.desserts.some(dessert => dishById.get(dessert.dishId)?.category !== "dessert")) return invalid(`Choose exactly ${requiredDesserts} dessert${requiredDesserts === 1 ? "" : "s"} from Sam's menu.`);
  if (selection.packageId === "gold" && guestCount % 2 !== 0) return invalid("Gold dessert portions for an odd guest count require an approved rounding rule.");
  if (selection.packageId === "gold" && selection.desserts.some(dessert => dessert.portions !== null && dessert.portions !== guestCount / 2)) return invalid("Gold dessert portions must be split equally.");
  return selection;
}

/** The production catalogue remains closed until every allocation rule is approved. */
export function assertHotForkBuffetCustomerSubmission(raw: unknown, itemId: string, guestCount: number): BuffetSelection {
  const selection = validateHotForkBuffetDraft(raw, itemId, guestCount);
  if (!hotForkBuffetMenu.readiness.customerSubmission) return invalid("Hot Fork Buffet menu ordering is awaiting package rule approval.");
  if (selection.desserts.some(dessert => dessert.portions === null)) return invalid("Dessert portions must be confirmed before ordering.");
  return selection;
}

/** Historical lines may receive contact-only edits; a new or changed package needs an approved selection. */
export function assertHotForkBuffetAmendment(input: {
  itemId: string;
  selection?: BuffetChoice;
  priorSelection?: BuffetChoice;
  previousItemExists: boolean;
  quantity: number;
  previousQuantity?: number;
  guestCount: number;
  previousGuestCount: number;
  selectorEnabled: boolean;
}): void {
  if (input.priorSelection && !input.selection) return invalid("An existing buffet selection cannot be silently removed from its package line.");
  const changed = !input.previousItemExists || input.quantity !== input.previousQuantity || input.guestCount !== input.previousGuestCount;
  if (input.selectorEnabled && buffetPackageForItem(input.itemId) && !input.selection && changed) return invalid("Choose a Hot Fork Buffet menu before changing its guest count or package line.");
  if (input.selection && (changed || JSON.stringify(input.selection) !== JSON.stringify(input.priorSelection))) {
    if (input.quantity !== input.guestCount) return invalid("Buffet package quantity must equal the guest count.");
    assertHotForkBuffetCustomerSubmission(input.selection.value, input.itemId, input.guestCount);
  }
}

export function hotForkBuffetChoice(choices: readonly unknown[] | undefined): BuffetChoice | undefined {
  const matches = (choices || []).filter(value => Boolean(value && typeof value === "object" && (value as { id?: unknown }).id === HOT_FORK_BUFFET_CHOICE_ID));
  if (matches.length > 1) return invalid("Only one Hot Fork Buffet menu selection is allowed.");
  return matches[0] as BuffetChoice | undefined;
}

export function hotForkBuffetDish(id: string): BuffetDish | undefined { return dishById.get(id); }

/** Read-only booking evidence for planners; this never allocates Menu Planning portions. */
export function hotForkBuffetSelectionDetails(raw: unknown) {
  const parsed = HotForkBuffetTransportSelectionSchema.safeParse(raw);
  if (!parsed.success) return undefined;
  const selection = parsed.data;
  const currentMenu = selection.menuVersion === HOT_FORK_BUFFET_MENU_VERSION;
  const label = (dishId: string) => currentMenu ? dishById.get(dishId)?.name || dishId : dishId;
  return {
    menuVersion: selection.menuVersion,
    menuStatus: currentMenu ? "current" as const : "historical-menu-unavailable" as const,
    mains: selection.mains.map(main => ({ dishId: main.dishId, name: label(main.dishId), portions: main.portions })),
    salads: selection.saladIds.map(dishId => ({ dishId, name: label(dishId), portionStatus: "manual-confirmation-required" as const })),
    desserts: selection.desserts.map(dessert => ({ dishId: dessert.dishId, name: label(dessert.dishId), portions: dessert.portions })),
  };
}
