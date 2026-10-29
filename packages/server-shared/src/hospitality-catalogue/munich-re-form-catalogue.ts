import type { HospitalityMenuItem, HospitalityOptionGroup } from "./hospitality-menu-catalogue";

/**
 * Munich RE orderable products, transcribed from the live "Hospitality Booking Form (2026)" Microsoft Form
 * (inspected 2026-10-29; the brochure is reference only). Prices are as printed on the form and the form states no VAT
 * treatment, so vatRate stays null (net) like the other site snapshots. The form's 2% service fee is a total-level
 * charge and is not modelled here.
 *
 * Every row carries a mapping classification against the company catalogue so the governed promotion (Hub catalogue
 * admin) can reuse existing Items instead of creating Munich RE copies. Nothing here creates or edits canonical records:
 *   existing-direct     - same product and price as a canonical Item; map the provider id
 *   existing-mr-config  - same canonical Item with an MR-specific price/variant/unit; map plus a governed site exception
 *   missing             - no canonical Item; needs governed creation (with routing) before it can be mapped
 *   ambiguous           - a canonical Item looks related but name/price/serving differ; owner decision required
 */
export type MunichReMappingClassification = "existing-direct" | "existing-mr-config" | "missing" | "ambiguous";

export const MUNICH_RE_FORM_SOURCE_PATH = "Munich Re Hospitality Booking Form (2026) - live Microsoft Form";
export const MUNICH_RE_PROVIDER = "munich-re-generic-brochure";

type Row = {
  id: string; name: string; category: string; price: number; serving: string; serves: number | null; noticeDays: number;
  groups?: Array<[id: string, label: string, kind: "select" | "multi", options: string[]]>;
  classification: MunichReMappingClassification; canonical?: string; note: string; description?: string;
};

const TEA_COFFEE_NOTICE_DAYS = 1; // "24 hours' notice for Tea/Coffee bookings"
const FOOD_NOTICE_DAYS = 3; // "72 hours' notice or 3 working days"
const MEAT_VEG: Row["groups"] = [["filling", "Choose filling", "multi", ["Mixed", "Meat", "Veggie"]]];

const rows: Row[] = [
  { id: "mr-tea-coffee", name: "Tea/Coffee", category: "Hot & Cold Drinks", price: 2.5, serving: "Per person", serves: null, noticeDays: TEA_COFFEE_NOTICE_DAYS, classification: "ambiguous", canonical: "specialty_tea_coffee (£3.50) / bloom_filter_coffee (£3.00)", note: "Form price £2.50 per person matches neither canonical Tea & Coffee Item." },
  { id: "mr-tea-coffee-biscuits", name: "Tea/Coffee/Biscuits", category: "Hot & Cold Drinks", price: 3.5, serving: "Per person", serves: null, noticeDays: TEA_COFFEE_NOTICE_DAYS, classification: "missing", note: "No canonical tea/coffee with biscuits." },
  { id: "mr-canned-soft-drinks", name: "Canned Soft Drinks", category: "Hot & Cold Drinks", price: 2.5, serving: "Per can", serves: null, noticeDays: FOOD_NOTICE_DAYS, classification: "existing-mr-config", canonical: "canned_drinks (£1.75)", note: "Same product; Munich RE price £2.50 is a governed site exception." },
  { id: "mr-cold-pressed-juice", name: "Individual Cold Pressed Juice", category: "Breakfast", price: 4, serving: "Per bottle", serves: null, noticeDays: FOOD_NOTICE_DAYS, groups: [["flavour", "Choose flavours", "multi", ["Green Juice", "Power", "Caravan Special"]]], classification: "ambiguous", canonical: "fresh_juice_250 (£3.00)", note: "Cold pressed flavours (Green Juice, Power, Caravan Special) differ from the canonical squeezed juice." },
  { id: "mr-jug-of-juice", name: "Jug of Juice", category: "Breakfast", price: 10, serving: "Each jug serves 5", serves: 5, noticeDays: FOOD_NOTICE_DAYS, groups: [["flavour", "Choose juice", "multi", ["Apple", "Orange", "Cranberry"]]], classification: "ambiguous", canonical: "fresh_juice_1l (£9.00)", note: "Jug serving 5 at £10 versus canonical 1L bottle at £9." },
  { id: "mr-seasonal-smoothie-jug", name: "Fresh Jug of Seasonal Smoothie", category: "Breakfast", price: 22.5, serving: "Each jug serves 5", serves: 5, noticeDays: FOOD_NOTICE_DAYS, groups: [["flavour", "Choose smoothie", "multi", ["Pash N' Shoot (Mango, Pineapple, Passion Fruit)", "Strawberry and Banana", "Oat of This World (Gluten Free Oats, Banana, Blueberry, Raspberry, Flaxseed)"]]], classification: "ambiguous", canonical: "smoothie_1l (£12.00)", note: "Jug serving 5 at £22.50 versus canonical 1L bottle at £12." },
  { id: "mr-breakfast-pastries-platter", name: "Breakfast Pastries Platter", category: "Breakfast", price: 20, serving: "Each platter feeds 5", serves: 5, noticeDays: FOOD_NOTICE_DAYS, description: "A selection of freshly baked mini Danish pastries and assorted mini muffins.", classification: "missing", note: "Canonical Mini Pastries is a £36 box feeding 12; not the same product." },
  { id: "mr-breakfast-bap-platter", name: "Breakfast Bap Platter", category: "Breakfast", price: 25, serving: "Each platter feeds 5", serves: 5, noticeDays: FOOD_NOTICE_DAYS, groups: [["filling", "Choose platter type", "multi", ["Mixed (Bacon, Sausage & Mushroom)", "Meat (Sausage & Bacon)", "Veggie (Mushroom)"]]], classification: "missing", note: "No canonical breakfast bap platter." },
  { id: "mr-premium-breakfast", name: "FIKA Premium Breakfast", category: "Breakfast", price: 25, serving: "Each option feeds 5", serves: 5, noticeDays: FOOD_NOTICE_DAYS, groups: [["option", "Choose options", "multi", ["A) The Estate Dairy Yoghurt, London Bee Honey with Granola", "B) Vegan Soya Yoghurt, Chia Seed, Blueberry Compote", "C) Cold Smoked Chalk Stream Trout, Whipped Cream Cheese & Chives on Sourdough Crostini", "D) Toasted Focaccia, Smashed Avocado & Sun Blush Tomatoes, Feta", "E) Dried Fruit & Seed Granola Bar", "F) Watermelon, Pineapple & Kiwi Skewer"]]], classification: "missing", note: "Canonical Healthy Plant Power Breakfast is a £22 per person item." },
  { id: "mr-fresh-fruit-bowl", name: "Fresh Fruit Bowl", category: "Breakfast", price: 20, serving: "Each bowl feeds 5", serves: 5, noticeDays: FOOD_NOTICE_DAYS, classification: "missing", note: "Canonical Exotic Fruit Box is £52.50 serving 20." },
  { id: "mr-rice-paper-rolls", name: "Freshly Wrapped Rice Paper Rolls", category: "Lunch", price: 45, serving: "Each platter feeds 3; 10 rolls with 5 dips", serves: 3, noticeDays: FOOD_NOTICE_DAYS, groups: [["flavour", "One flavour per platter", "multi", ["A) Char-Siu Pulled Chicken Roll", "B) Lemongrass Chilli Chicken Roll", "C) Crayfish & Avocado Roll", "D) Hot Smoked Trout Roll", "E) Rainbow Vegetable Roll (Vegan)", "F) Hoi-Sin Tofu & Rainbow Veg Roll (Vegan)"]]], classification: "existing-direct", canonical: "rice_paper_rolls (£45.00, feeds 3)", note: "Same product and price. The form says 10 rolls where the brochure item says 12 wraps, and the canonical Item carries a minimum of 3 that the form does not state: confirm." },
  { id: "mr-deli-sandwich-platter", name: "Deli Style Sandwich Platter", category: "Lunch", price: 50, serving: "Each platter feeds 5", serves: 5, noticeDays: FOOD_NOTICE_DAYS, groups: MEAT_VEG, description: "Fresh made deli style sandwiches on focaccia, ciabatta, baguettes and wraps; the equivalent of 1.5 sandwiches/wraps per person with a selection of crisps.", classification: "ambiguous", canonical: "deli_sandwich_lunch (£9.00 per person, minimum 8)", note: "£50 per 5 people is £10 per person; the canonical Item is £9 per person (£45 for 5). Owner must decide whether Munich RE orders the per-person Item at a minimum of 5 or this platter." },
  { id: "mr-salad-protein-platter", name: "Salad & Protein Lunch Platter", category: "Lunch", price: 70, serving: "Each platter serves 5", serves: 5, noticeDays: FOOD_NOTICE_DAYS, description: "A selection of 4 composite salads plus one meat, one fish and one veggie/vegan protein.", classification: "existing-mr-config", canonical: "salad_protein_lunch_platter (£14.00 per person, minimum 8)", note: "5 x £14 = £70, so one platter equals the canonical per-person Item at the Munich RE minimum of 5. Confirm before mapping." },
  { id: "mr-finger-food", name: "FIKA Finger Food", category: "Finger Food", price: 18.75, serving: "Per option; 5 small servings", serves: 5, noticeDays: FOOD_NOTICE_DAYS, groups: [["option", "Choose options (recommend 3 options per 5 people)", "multi", ["A) Tikka Paneer Skewer, Minted Yoghurt Dip", "B) Summer Pea, Mascarpone & Pesto Tartlet", "C) Traditional Falafel & Tahini Dip", "D) Vegetable Samosa, Tamarind Chutney", "E) Breaded Halloumi Fries with Spicy Tomato Chutney", "F) Cherry Tomato, Bocconcini & Fresh Basil Skewer", "G) Bruschetta, White Bean & Tarragon Pate & Asparagus", "H) Plant Based Slider, Kimchi Pickle Sriracha Mayo", "I) Vegetable Gyoza, Soy Dipping Sauce", "J) Greek Salad Skewer"]]], classification: "ambiguous", canonical: "finger_food (£3.95 per piece, minimum 4)", note: "£18.75 for 5 servings is £3.75 each versus £3.95 per piece." },
  { id: "mr-light-table-lunch", name: "Light Table Lunch (Served on Platters)", category: "Finger Food", price: 150, serving: "Feeds 10", serves: 10, noticeDays: FOOD_NOTICE_DAYS, description: "British artisan cheese with apple cider chutney and grapes, plant based sausage rolls, fire roasted red pepper, potato and spinach frittata, garden pea, feta and pesto tarts. Items set and subject to seasonal change.", classification: "missing", note: "No canonical equivalent." },
  { id: "mr-garden-mezze", name: "Garden Mezze (Served on Platters)", category: "Finger Food", price: 160, serving: "Feeds 10", serves: 10, noticeDays: FOOD_NOTICE_DAYS, description: "Crudités, edamame, sweet potato falafel, olives, dolmades, toasted pita with three hummus, breads, greens and grains salad, tomato bocconcini salad, Caesar salad. Items set and subject to seasonal change.", classification: "missing", note: "No canonical equivalent." },
  { id: "mr-afternoon-tea-platter", name: "Afternoon Tea Platter", category: "Afternoon & Events", price: 150, serving: "Feeds 10", serves: 10, noticeDays: FOOD_NOTICE_DAYS, description: "Finger cut sandwiches, mini cakes (brownie, lemon drizzle, macarons, éclairs, Battenberg) and sultana scones with clotted cream and jam.", classification: "ambiguous", canonical: "afternoon_tea (£21.95 per person, minimum 8)", note: "£150 for 10 is £15 per person versus £21.95." },
  { id: "mr-charcuterie-platter", name: "Meat or Plant Based Charcuterie Platter", category: "Afternoon & Events", price: 120, serving: "Feeds 10", serves: 10, noticeDays: FOOD_NOTICE_DAYS, groups: [["version", "Choose version", "select", ["Meat", "Plant Based"]]], classification: "ambiguous", canonical: "grazing_charcuterie_box (£75.00, feeds 10)", note: "Same serving, different price (£120 versus £75)." },
  { id: "mr-bar-snack-platter", name: "Bar Snack Platter", category: "Afternoon & Events", price: 25, serving: "Feeds 5", serves: 5, noticeDays: FOOD_NOTICE_DAYS, classification: "missing", note: "No canonical equivalent." },
  { id: "mr-champagne-devaux", name: "Champagne: NV Grande Réserve, Devaux, France", category: "Afternoon & Events", price: 54, serving: "Per bottle", serves: null, noticeDays: FOOD_NOTICE_DAYS, classification: "missing", note: "Alcohol; no canonical Item or routing decision." },
  { id: "mr-sparkling-prosecco", name: "Sparkling Wine: NV Monopolio Prosecco Spumante Organic, Italy", category: "Afternoon & Events", price: 24, serving: "Per bottle", serves: null, noticeDays: FOOD_NOTICE_DAYS, classification: "missing", note: "Alcohol; no canonical Item." },
  { id: "mr-white-macabeo", name: "White Wine: 2024 Organic Macabeo, Spain", category: "Afternoon & Events", price: 18, serving: "Per bottle", serves: null, noticeDays: FOOD_NOTICE_DAYS, classification: "missing", note: "Alcohol; no canonical Item." },
  { id: "mr-red-monastrell", name: "Red Wine: 2024 Organic Monastrell, Spain", category: "Afternoon & Events", price: 18, serving: "Per bottle", serves: null, noticeDays: FOOD_NOTICE_DAYS, classification: "missing", note: "Alcohol; no canonical Item." },
  { id: "mr-rose-rosado", name: "Rosé Wine: 2024 Organic Rosado, Spain", category: "Afternoon & Events", price: 18, serving: "Per bottle", serves: null, noticeDays: FOOD_NOTICE_DAYS, classification: "missing", note: "Alcohol; no canonical Item." },
  { id: "mr-bottled-beer", name: "Bottled Beer", category: "Afternoon & Events", price: 3.5, serving: "Per bottle", serves: null, noticeDays: FOOD_NOTICE_DAYS, groups: [["style", "Choose style", "multi", ["Lager", "Pale Ale", "0%"]]], classification: "missing", note: "Alcohol; no canonical Item." },
  { id: "mr-dessert-pots-platter", name: "Dessert Pots Platter", category: "Sweet Treats", price: 25, serving: "Feeds 5; each option has 5 servings", serves: 5, noticeDays: FOOD_NOTICE_DAYS, groups: [["option", "Choose options (recommend 1 option per 5 people)", "multi", ["A) Classic Tiramisu", "B) Orange & Cardamom Panna Cotta, Caramelised Honey & Chilli Orange", "C) Coconut Rice Pudding with Roasted Pineapple & Lychee", "D) Lemon Posset, Ginger Biscuit Crumb & Freeze-Dried Raspberries", "E) Rich Chocolate & Chilli Pot", "F) Mango & Chia Parfait", "G) Exotic Fresh Fruit Salad Pot"]]], classification: "missing", note: "No canonical equivalent." },
  { id: "mr-loaf-cake-platter", name: "Loaf Cake Platter", category: "Sweet Treats", price: 25, serving: "Feeds 5; each option has 5 servings", serves: 5, noticeDays: FOOD_NOTICE_DAYS, groups: [["option", "Choose options (recommend 1 option per 5 people)", "multi", ["A) Vegan Banana Bread", "B) Lemon Drizzle"]]], classification: "missing", note: "No canonical equivalent." },
  { id: "mr-traybake-bites-platter", name: "Traybake Bites Platter", category: "Sweet Treats", price: 25, serving: "Feeds 5", serves: 5, noticeDays: FOOD_NOTICE_DAYS, description: "Salted caramel brownies, flapjacks, blondie and black cherry bakewell.", classification: "missing", note: "Canonical Tray Bake Box is a £75 box of 24." },
];

/** Form items shown without a price (Still/Sparkling Water for Flex). Never orderable until the owner supplies a price. */
export const MUNICH_RE_FORM_UNPRICED = [
  { sourceItemId: "mr-flex-water", name: "Still/Sparkling Water for Flex (Amazon & Avon) only", note: "The form asks for the number of attendees and states no price." },
] as const;

const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export const munichReFormItems: HospitalityMenuItem[] = rows.map((row, index) => {
  const optionGroups: HospitalityOptionGroup[] = (row.groups || []).map(([id, label, selectionType, options]) => ({
    id, label, selectionType, required: true, options: options.map((option) => ({ id: `${id}:${slug(option)}`, label: option })),
  }));
  return {
    canonicalId: `hospitality-menu-item:munich-re:${row.id}`,
    source: { provider: MUNICH_RE_PROVIDER, sourcePath: MUNICH_RE_FORM_SOURCE_PATH, sourceItemId: row.id },
    name: row.name,
    ...(row.description ? { description: row.description } : {}),
    category: row.category,
    pricing: { unitPrice: row.price, currency: "GBP", basis: row.serves ? "per_platter_or_option" : "per_item", servingInfo: row.serving, vatRate: null },
    orderingConstraints: { minimumQuantity: 1, minimumGuests: null, noticeRequiredDays: row.noticeDays, serves: row.serves, suggestionType: null, suggestionLabel: row.serving, suggestionUnit: "units" },
    optionGroups,
    dietaryInformation: [],
    allergenInformation: [],
    lifecycleState: "active",
    sortOrder: index,
  } satisfies HospitalityMenuItem;
});

export const munichReFormMapping = rows.map((row) => ({
  sourceItemId: row.id, name: row.name, price: row.price, classification: row.classification, canonicalCandidate: row.canonical ?? null, note: row.note,
}));
