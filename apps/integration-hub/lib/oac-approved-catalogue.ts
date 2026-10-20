/**
 * One Angel Court 2026 brochure: the operator-approved catalogue decisions, as data.
 * Pure and file-only: builds governed command PROPOSALS. It never applies anything.
 * Every command is scoped to the OAC OPLOC; shared defaults, shared routing and other sites are never touched.
 */
import { createHash } from "node:crypto";
import type { CatalogueCommand, PriceInput } from "./hospitality-catalogue-admin";
import type { RoutingChoice } from "./hospitality-catalogue-types";
import type { CatalogueSyncEntry } from "./oac-catalogue-sync-plan";

export const OAC_OPLOC_ID = "oploc:24a93500-d75d-4fe0-8beb-672d36f9da10";
/** A VAT rate is written only when the operator has approved one for NEW products. Overrides on existing Items omit it and so inherit the Item's governed rate. */
export type OacTaxApproval = { newItemVatRate: number };
type Choice = { id: string; label: string; controlType: "select" | "multi" | "quantities"; minimumQuantity?: number; required: boolean; options: Array<{ id: string; label: string }> };
type Config = NonNullable<Extract<CatalogueCommand, { action: "create-item" }>["configuration"]>;
type Rules = NonNullable<Config["rules"]>;

const slug = (label: string) => label.toLowerCase().normalize("NFKD").replace(/\p{M}/gu, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const options = (prefix: string, labels: string[]) => labels.map(label => ({ id: `${prefix}:${slug(label)}`, label }));
/** One quantity per named variety; each selected variety needs `minimum`; the allocation must add up to the ordered quantity. */
const allocation = (id: string, label: string, minimum: number, labels: string[]): Choice => ({ id, label, controlType: "quantities", minimumQuantity: minimum, required: true, options: options(id, labels) });
const price = (amount: number, vatRate?: number): PriceInput => (vatRate === undefined ? { amount } : { amount, vatRate });
type Notice = { noticeRequiredDays: number; noticeHours: number };
const days10: Notice = { noticeRequiredDays: 10, noticeHours: 240 };

export const finger = ["Ploughmans Crostini (Pulled Ham, Cheddar & Chutney)", "Char-Siu Chicken & Spring Onion Skewer", "Chorizo & Pumpkin Seed Sausage Roll", "Hot Smoked Salmon, Pea Pesto on Pumpernickel", "Miso Salmon Skewer & Furikake Kewpie", "\"Bloody Marie\" Crayfish Rolls", "Baby Plum Tomato, Boccaccino & Basil Pesto Skewers", "Tomato & Basil Tartlet", "Goats Cheese Cheesecake, Red Onion Jam", "Sweet Potato Falafel with Beetroot Hummus", "Pickled Wild Mushroom Crostini, Whipped Herb Vegan Cream Cheese", "Gluten Free Sweetcorn Muffin with Chilli Cream Cheese", "Rich Chocolate Tart", "White Chocolate Cheesecake Shot Glass, Blueberry Compote", "Passion Fruit Meringue Pie"];
const croissantFillings = ["Swiss Cheese, Wiltshire Ham & Vine Tomato", "Free-Range Egg Mayonnaise, Sun Blush Tomato & Roquette", "Smoked Chalk Stream Trout, Cream Cheese & Dill"];
const nibbles = ["Spicy Chilli Crackers", "Salted Pretzels", "Sea Salted Crisps", "Goats Cheese & Black Pepper Popcorn", "Mini Salsa Baguettes"];
const salads = ["Mediterranean", "Grilled Chicken Caesar", "Hot Smoked Salmon Niçoise", "Weekly Salad Box"];
const wines: Array<[string, number]> = [["Organic Macabeo, Familia Castaño, Murcia, Spain", 27], ["Vinho Verde Loureiro/Alvarinho, Quinta de Azevedo, Portugal", 31], ["Picpoul de Pinet, Domaine La Croix Gratiot, Languedoc, France", 34], ["Organic Rosado, Familia Castaño, Murcia, Spain", 27], ["Touraine Rosé, Domaine de La Brossette, Loire, France", 35], ["Organic Monastrell, Familia Castaño, Murcia, Spain", 27], ["Nero d'Avola, Mandrarossa, Sicily, Italy", 32], ["Mendoza Malbec Clásico Organic, Altos Las Hormigas, Argentina", 36], ["NV Monopolio Prosecco Spumante Organic, Cantina di Gambellara, Veneto, Italy", 32], ["2022 Blanc de Blancs, Raventós i Blanc, Cataluña, Spain", 37], ["2019 Classic Cuvée Brut, Rathfinny Wine Estate, Sussex, England", 60]];

export type LiveItem = { canonicalId: string; version: number; configuration?: { choices?: Array<{ options: Array<{ id: string; label: string }> }> } };
export type LiveLookup = (canonicalId: string) => LiveItem | undefined;

/** Deterministic id of an item that a plan will create (same formula as the governed create-item command). */
export const createdItemId = (requestId: string) => `hospitality-menu-item:${createHash("sha256").update(`catalogue-create:${requestId}`).digest("hex").slice(0, 32)}`;
export const requestIdFor = (key: string) => `oac-2026-brochure:${key}`;

type Create = { key: string; product: string; name: string; category: string; routing: RoutingChoice; price?: number; minimumQuantity?: number; minimumGuests?: number; notice?: Notice; mode?: "quote_only"; config: Config };
function createEntry(c: Create, tax?: OacTaxApproval): CatalogueSyncEntry {
  const rules: Rules | undefined = c.config.rules || c.notice ? { ...(c.config.rules || {}), ...(c.notice ? { noticeHours: c.notice.noticeHours } : {}) } : undefined;
  const command: CatalogueCommand = {
    action: "create-item", requestId: requestIdFor(c.key), name: c.name, category: c.category, routing: c.routing, oplocIds: [OAC_OPLOC_ID], restrictToSelectedOplocs: true,
    ...(c.price !== undefined ? { defaultPrice: price(c.price, tax?.newItemVatRate) } : {}), ...(c.minimumQuantity ? { defaultMinimumQuantity: c.minimumQuantity } : {}), ...(c.minimumGuests ? { minimumGuests: c.minimumGuests } : {}),
    ...(c.notice ? { noticeRequiredDays: c.notice.noticeRequiredDays } : {}), ...(c.mode ? { offeringMode: c.mode } : {}), configuration: { ...c.config, ...(rules ? { rules } : {}) }
  };
  const needsTax = c.price !== undefined && tax === undefined;
  return { key: c.key, product: c.product, classification: "create", command, businessApprovalRequired: false, routingApprovalRequired: false, taxApprovalRequired: needsTax, ...(needsTax ? { reason: "VAT treatment for this new priced product is unresolved: no governed product tax classification exists." } : {}) };
}

type Update = { key: string; product: string; itemId: string; price?: number; minimumQuantity?: number; minimumGuests?: number; notice?: Notice; mode?: "quote_only"; displayName?: string; description?: string; config?: Config };
function update(u: Update, live: LiveLookup): CatalogueSyncEntry {
  const item = live(u.itemId);
  if (!item) return { key: u.key, product: u.product, classification: "review", businessApprovalRequired: true, routingApprovalRequired: false, reason: `Canonical Item ${u.itemId} not found in the supplied live source; refresh evidence.` };
  const rules = u.config?.rules || u.notice ? { ...(u.config?.rules || {}), ...(u.notice ? { noticeHours: u.notice.noticeHours } : {}) } : undefined;
  const configuration = u.config || rules ? { ...(u.config || {}), ...(rules ? { rules } : {}) } : undefined;
  const command: CatalogueCommand = {
    action: "set-site-override", itemId: u.itemId, expectedVersion: item.version, oplocId: OAC_OPLOC_ID,
    ...(u.price !== undefined ? { price: price(u.price) } : {}), ...(u.minimumQuantity !== undefined ? { minimumQuantity: u.minimumQuantity } : {}), ...(u.minimumGuests !== undefined ? { minimumGuests: u.minimumGuests } : {}),
    ...(u.notice ? { noticeRequiredDays: u.notice.noticeRequiredDays } : {}), ...(u.mode ? { offeringMode: u.mode } : {}), ...(configuration ? { configuration } : {})
  };
  return { key: u.key, product: u.product, classification: "update", command, businessApprovalRequired: false, routingApprovalRequired: false };
}
const same = (key: string, product: string, reason: string): CatalogueSyncEntry => ({ key, product, classification: "correct", businessApprovalRequired: false, routingApprovalRequired: false, reason });

/** All 53 brochure rows (plus the Classic exclusion), in dependency order: the House Drinks parent precedes its upgrades. */
export function approvedOacEntries(live: LiveLookup, tax?: OacTaxApproval): CatalogueSyncEntry[] {
  const e: CatalogueSyncEntry[] = [];
  const create = (c: Create) => createEntry(c, tax);
  const pre = "hospitality-menu-item:rcoa:";
  e.push(same("01-mini-pastries", "Mini Pastries", "£36 box feeds 12: already correct; CPU Hospitality unchanged."));
  e.push(update({ key: "02-breakfast-pots", product: "Yoghurt pot selection", itemId: pre + "breakfast_pots", price: 3.5 }, live)); // existing Breakfast Pots: £3.50, minimum 12 already held by the Item; Gallagher cap via shared rule
  e.push(create({ key: "03-whole-fruit-bowl", product: "Whole fruit bowl", name: "Whole Fruit Bowl", category: "Breakfast", routing: "cpu_hospitality", price: 2, minimumQuantity: 1, config: { servingInfo: "Per person", rules: { salesUnit: "person" } } }));
  e.push(create({ key: "04-sliced-fruit", product: "Fresh sliced fruit platter", name: "Fresh Sliced Fruit Platter", category: "Breakfast", routing: "cpu_hospitality", price: 20, minimumQuantity: 1, config: { serves: 8, servingInfo: "Platter serves 8", rules: { salesUnit: "platter" } } }));
  e.push(create({ key: "05-baps", product: "Sausage or Bacon Breakfast Baps", name: "Sausage or Bacon Breakfast Baps", category: "Breakfast", routing: "in_house", price: 3.95, minimumQuantity: 10, config: { servingInfo: "Per bap - minimum 10", choices: [allocation("filling", "Choose filling", 1, ["Sausage", "Bacon"])], rules: { salesUnit: "bap" } } }));
  e.push(create({ key: "06-croissant-each", product: "Savoury filled croissants", name: "Savoury Filled Croissant (each)", category: "Breakfast", routing: "cpu_hospitality", price: 5, minimumQuantity: 12, config: { servingInfo: "Per croissant - minimum 12", choices: [allocation("filling", "Choose fillings", 1, croissantFillings)], rules: { salesUnit: "croissant", productionConversion: { multiplier: 1, unit: "croissant" } } } }));
  e.push(same("07-bagel-box", "Bagel Box", "£72 box of 12 halved bagels: already correct; CPU Sandwiches unchanged."));
  e.push(update({ key: "08-soft-drinks", product: "Soft drinks", itemId: pre + "canned_drinks", price: 2, config: { description: "Coke, Diet Coke, Coke Zero or Sprite.", choices: [{ id: "drink", label: "Choose drink", controlType: "select", required: true, options: options("drink", ["Coke", "Diet Coke", "Coke Zero", "Sprite"]) }] } }, live));
  e.push(update({ key: "09-juice", product: "Fresh juice — Orange / Apple / Carrot, Pear & Ginger", itemId: pre + "fresh_juice_250", config: { description: "Fresh squeezed orange or apple juice, or carrot, pear & ginger.", choices: [allocation("flavour", "Choose juices", 1, ["Orange", "Apple", "Carrot, Pear & Ginger"])] } }, live)); // £3 already the live OAC price
  e.push(same("10-juice-apple", "Fresh juice — Apple", "Covered by the single canonical 250ml Item override (key 09)."));
  e.push(same("11-juice-carrot", "Fresh juice — Carrot, Pear & Ginger", "Covered by the single canonical 250ml Item override (key 09)."));
  e.push(update({ key: "12-water", product: "Bottled still/sparkling water 750ml", itemId: pre + "belu_water", price: 3.5 }, live));
  e.push(update({ key: "13-deli-sandwich", product: "Deli Style Sandwich", itemId: "hospitality-menu-item:mnk:deli_sandwich_lunch", price: 10.95, minimumQuantity: 10, displayName: "Deli Style Sandwich", config: { rules: { guestMinimumKind: "product", salesUnit: "person", productionConversion: { multiplier: 3, unit: "sandwich piece" } } } }, live));
  e.push(update({ key: "14-salad-boxes", product: "Salad Boxes", itemId: pre + "salad_boxes", config: { serves: 8, servingInfo: "Medium box serves 8 - one variety per box", choices: [allocation("salad", "Choose salad varieties (one per box)", 1, salads)], rules: { salesUnit: "box" } } }, live));
  e.push(same("15-exotic-fruit", "Exotic Fruit Box", "£52.50 box feeds up to 20: already correct; CPU Hospitality unchanged."));
  e.push(create({ key: "16-traybake-bites", product: "Mini traybake bites", name: "Mini Traybake Bites", category: "Lunch Add-ons", routing: "cpu_hospitality", price: 6, minimumQuantity: 1, config: { serves: 4, description: "An assortment of brownie, brookies, caramel shortbread and blondie bites (the assortment is not a customer-selected mix).", servingInfo: "Serves 4", rules: { salesUnit: "box" } } }));
  e.push(create({ key: "17-cake-slice", product: "Cake slice", name: "Cake Slice", category: "Lunch Add-ons", routing: "cpu_hospitality", price: 3.5, minimumQuantity: 1, config: { servingInfo: "Per person", rules: { salesUnit: "slice" } } }));
  e.push(create({ key: "18-celebration-cake", product: "Celebration cake", name: "Celebration Cake", category: "Lunch Add-ons", routing: "cpu_hospitality", mode: "quote_only", config: { serves: 12, servingInfo: "From £27; serves 12; at least 72 hours notice; quote required", rules: { indicativeFrom: 27, noticeHours: 72, salesUnit: "cake" } } }));
  e.push(update({ key: "19-loaf-cake", product: "Loaf cake", itemId: pre + "loaf_cake", mode: "quote_only", notice: { noticeRequiredDays: 3, noticeHours: 72 }, config: { serves: 10, servingInfo: "From £20; serves 10; at least 72 hours notice; quote required", rules: { indicativeFrom: 20, salesUnit: "cake" } } }, live));
  e.push(update({ key: "20-canapes", product: "FIKA Canapes", itemId: pre + "canapes", notice: days10, config: { rules: { guestMinimumKind: "event" } } }, live));
  e.push(update({ key: "21-bowl-food", product: "Bowl Food", itemId: pre + "bowl_food", minimumGuests: 20, notice: days10, config: { rules: { guestMinimumKind: "event" } } }, live));
  e.push(update({ key: "22-finger-food", product: "Finger Food", itemId: pre + "finger_food", minimumQuantity: 12, minimumGuests: 20, notice: days10, config: { servingInfo: "Per piece - minimum 12 of each selected variety", choices: [allocation("variety", "Choose varieties (minimum 12 of each)", 12, finger)], rules: { guestMinimumKind: "event", salesUnit: "piece" } } }, live));
  const flavours = live(pre + "rice_paper_rolls")?.configuration?.choices?.[0]?.options;
  e.push(update({ key: "23-summer-rolls", product: "Summer Roll Platters", itemId: pre + "rice_paper_rolls", price: 30, minimumQuantity: 3, minimumGuests: 20, notice: days10, config: { servingInfo: "12 rolls per platter - one flavour per platter - minimum 3 platters", description: "Crayfish & avocado and hot smoked trout rolls come with sweet chilli sauce; char-siu chicken and lemongrass chicken rolls with tamari soya sauce; the vegan rainbow vegetable and hoi-sin tofu rolls with peanutless satay sauce.", choices: flavours ? [{ id: "flavour", label: "Choose a flavour for each platter", controlType: "quantities", minimumQuantity: 1, required: true, options: flavours }] : [], rules: { guestMinimumKind: "event", salesUnit: "platter", productionConversion: { multiplier: 12, unit: "roll" } } } }, live));
  e.push(create({ key: "24-classic-buffet", product: "Classic Buffet", name: "Classic Buffet", category: "Events Catering", routing: "cpu_hospitality", price: 18, minimumQuantity: 50, minimumGuests: 50, notice: days10, config: { description: "Freshly baked sausage rolls, Scotch eggs, pork pies, chicken skewers and tomato quiche; Stokes beer chutney and red onion marmalade; salted pretzels, sea salt crisps, spicy chilli crackers, hand cooked vegetable crisps and sweet tray bake bites.", servingInfo: "Per person - minimum 50 guests", rules: { guestMinimumKind: "event", salesUnit: "person" } } }));
  e.push(same("25-cheese-platter", "Cheese platter", "£75 feeds 10: already correct; CPU Hospitality unchanged."));
  e.push(same("26-charcuterie-platter", "Charcuterie platter", "£75 feeds 10: already correct; CPU Hospitality unchanged."));
  e.push(create({ key: "27-bread-basket", product: "Bread basket", name: "Bread Basket", category: "Add-ons", routing: "cpu_hospitality", price: 15, minimumQuantity: 1, config: { serves: 10, servingInfo: "Serves 10", rules: { salesUnit: "basket" } } }));
  e.push(create({ key: "28-nibble-bowls", product: "Nibble bowls", name: "Nibble Bowls", category: "Add-ons", routing: "in_house", price: 2, minimumQuantity: 3, config: { serves: 3, servingInfo: "One bowl serves 3 - minimum 3 bowls of each selected variety", choices: [allocation("variety", "Choose nibbles (minimum 3 bowls of each)", 3, nibbles)], rules: { salesUnit: "bowl" } } }));
  e.push(update({ key: "29-picnic-grazing", product: "Picnic Grazing Table", itemId: pre + "picnic_grazing_table", notice: days10, config: { rules: { guestMinimumKind: "event" } } }, live));
  e.push(create({ key: "30-standard-bbq", product: "Standard BBQ", name: "Standard BBQ", category: "Summer BBQ Catering", routing: "cpu_hospitality", price: 25, minimumQuantity: 20, minimumGuests: 20, notice: days10, config: { description: "Beef and mature cheddar brioche burger, plant based brioche burger, Cajun quarter chicken leg, halloumi and roasted vegetable skewers, chargrilled corn on the cob, baby new potato salad, garden salad and coleslaw.", servingInfo: "Per person - minimum 20 guests", rules: { guestMinimumKind: "event", salesUnit: "person" } } }));
  e.push(create({ key: "31-premium-bbq", product: "Premium BBQ", name: "Premium BBQ", category: "Summer BBQ Catering", routing: "cpu_hospitality", price: 32.5, minimumQuantity: 20, minimumGuests: 20, notice: days10, config: { description: "Beef and mature cheddar brioche burger, plant based brioche burger, smoked ribs with BBQ glaze, chargrilled catch of the day, halloumi and roasted vegetable skewers, chargrilled corn on the cob, baby new potato salad, garden salad and coleslaw.", servingInfo: "Per person - minimum 20 guests", rules: { guestMinimumKind: "event", salesUnit: "person" } } }));
  wines.forEach(([name, amount], i) => e.push(create({ key: `${32 + i}-wine-${slug(name).slice(0, 24)}`, product: name, name, category: "Wine", routing: "in_house", price: amount, minimumQuantity: 1, config: { servingInfo: "Per bottle", rules: { salesUnit: "bottle" } } })));
  e.push(create({ key: "43-house-drinks", product: "House Drinks Package", name: "House Drinks Package", category: "Drinks & Packages", routing: "in_house", price: 15, minimumQuantity: 1, config: { description: "One hour of house wine, beer and soft drinks.", servingInfo: "Per person - one hour", rules: { salesUnit: "person" } } }));
  const parent = createdItemId(requestIdFor("43-house-drinks"));
  const pitchers: Array<[string, string, number, number]> = [["44", "Pimms pitcher", 68, 12], ["45", "Aperol Spritz pitcher", 68, 12], ["46", "Mojito Mocktail pitcher", 45, 10], ["47", "Passionfruit and Elderflower Spritz pitcher", 45, 10], ["48", "Mint and Mango Iced Green Tea pitcher", 45, 10]];
  for (const [n, name, amount, serves] of pitchers) e.push(create({ key: `${n}-${slug(name)}`, product: name, name, category: "Drinks & Packages", routing: "in_house", price: amount, minimumQuantity: 1, config: { serves, servingInfo: `Pitcher serves ${serves}`, rules: { salesUnit: "pitcher" } } }));
  const upgrades: Array<[string, string, number]> = [["49", "Premium wine add-on", 10], ["50", "Prosecco add-on", 10], ["51", "Champagne add-on", 15], ["52", "Cocktails add-on", 12], ["53", "Mocktails add-on", 8]];
  for (const [n, name, amount] of upgrades) e.push(create({ key: `${n}-${slug(name)}`, product: name, name: `House Drinks upgrade: ${name.replace(" add-on", "")}`, category: "Drinks & Packages", routing: "in_house", price: amount, minimumQuantity: 1, config: { servingInfo: "Per person - for the whole House Drinks Package guest count", rules: { parentItemId: parent, parentQuantity: "same", salesUnit: "person" } } }));
  e.push({ key: "oac-2026-classic-excluded", product: "Classic Working Lunch", classification: "exclude", businessApprovalRequired: false, routingApprovalRequired: false, reason: "Absent from the live canonical catalogue; never created. Historical references retained." });
  return e;
}
