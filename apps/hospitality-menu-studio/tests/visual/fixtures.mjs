import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";

export const fixtureDate = "2026-11-30";
export const fixtureTime = "2026-11-26T12:00:00.000Z";
export const sites = [
  { id: "oploc:visual-harbour", label: "Harbour House" },
  { id: "oploc:visual-park", label: "Park Square" },
  { id: "oploc:visual-riverside", label: "Riverside Centre" },
];

const productSpecs = [
  ["afternoon-tea", "Afternoon Tea", "Afternoon Tea", 16.20],
  ["breakfast-pots", "Breakfast Pots", "Breakfast", 5.40],
  ["bowl-food", "Bowl Food", "Bowl Food", 8.95],
  ["coffee-and-tea", "Coffee & Tea", "Drinks", 2.20],
  ["deluxe-sandwiches", "Deluxe Sandwiches", "Sandwiches", 8.75],
  ["finger-food", "Finger Food", "Finger Food", 10.50],
  ["fruit-platter", "Fruit Platter", "Sides", 13.20],
  ["hot-fork-buffet", "Hot Fork Buffet", "Hot Buffet", 19.25],
  ["pastry-selection", "Pastry Selection", "Breakfast", 6.95],
  ["salad-selection", "Salad Selection", "Salads", 8.25],
  ["small-plates", "Small Plates", "Lunch", 13.40],
  ["sweet-bites", "Sweet Bites", "Desserts", 4.85],
  ["seasonal-soup", "Seasonal Soup", "Lunch", 6.60],
];

export const itemId = key => "hospitality-menu-item:visual-" + key;
const products = productSpecs.map(([key, name, category, amount]) => ({ id: itemId(key), name, category, amount }));
const dishSpecs = [
  ["Chickpea & harissa fritters", "other", "hot", "Spiced chickpea bites with a lemon and herb dressing."],
  ["Smoked salmon & dill blinis", "fish", "cold", "Buckwheat blinis with smoked salmon, fresh dill and lemon."],
  ["Halloumi & roast pepper skewers", "other", "hot", "Grilled halloumi with sweet peppers and a parsley dressing."],
  ["Mushroom & thyme tartlets", "other", "hot", "Small pastry cases filled with mushrooms and thyme."],
  ["Mini chicken shawarma wraps", "meat", "cold", "Spiced chicken with pickled cabbage and a yoghurt dressing."],
  ["Butternut & sage croquettes", "other", "hot", "Golden croquettes with sweet butternut and sage."],
  ["Apple & cinnamon overnight oats", "other", "cold", "Rolled oats with apple compote and a pinch of cinnamon."],
  ["Berry yoghurt & granola", "other", "cold", "Greek-style yoghurt layered with berries and toasted oats."],
  ["Vanilla chia pot", "other", "cold", "Vanilla chia pudding with a spoonful of berry compote."],
  ["Roasted peach breakfast pot", "other", "cold", "Peaches, oats and yoghurt with a drizzle of honey."],
  ["Ginger chicken & sesame rice", "meat", "hot", "Ginger chicken served with sesame rice and greens."],
  ["Roast squash & black bean bowl", "other", "hot", "Roasted squash, black beans and coriander dressing."],
  ["Lemon & herb quinoa", "salad", "cold", "Quinoa with leafy herbs, lemon and cucumber."],
  ["Soy noodle & edamame salad", "salad", "cold", "Noodles and edamame in a sesame and soy dressing."],
  ["Garden pea & mint cups", "other", "cold", "Garden peas finished with lemon and fresh mint."],
  ["Tomato & basil arancini", "other", "hot", "Crisp risotto bites with tomato and basil."],
  ["Carrot & coriander bites", "other", "hot", "Roasted carrot bites finished with fresh coriander."],
  ["Roasted beetroot & goat cheese", "other", "cold", "Beetroot and goat cheese on a crisp cracker."],
];
export const dishes = dishSpecs.map(([name, category, temperature, customerDescription], index) => ({
  id: "visual-dish-" + String(index + 1).padStart(2, "0"), version: 1, updatedAt: fixtureTime,
  name, category, temperature, customerDescription, kitchenDescription: "Fictional kitchen instruction, excluded from preview.",
  assortment: null,
}));

const reference = index => ({ dishId: dishes[index].id, revision: dishes[index].version });
const flat = indices => ({ dishes: indices.map(reference), groups: [] });
const configuration = (presentation, schedule, groups = []) => ({ presentation, schedule, groups });
const fixed = choices => ({ kind: "fixed", choices });
const draft = (key, configuration) => ({ schemaVersion: 1, itemId: itemId(key), version: 2, updatedAt: fixtureTime, configuration });
const drafts = [
  draft("finger-food", configuration("quantities", {
    kind: "rotation", anchorMonday: fixtureDate,
    weeks: [[0, 1, 2, 3, 4, 5], [14, 15, 16, 17, 0, 1], [2, 3, 14, 4, 16, 5],
      [1, 17, 0, 5, 15, 16], [14, 1, 3, 17, 4, 15], [16, 5, 3, 0, 14, 2]].map(flat),
  })),
  draft("breakfast-pots", configuration("dropdown", fixed(flat([6, 7, 8, 9])))),
  draft("bowl-food", configuration("quantities", fixed({
    dishes: [], groups: [{ groupId: "visual-hot", dishes: [10, 11].map(reference) }, { groupId: "visual-cold", dishes: [12, 13].map(reference) }],
  }), [{ id: "visual-hot", name: "Hot bowls" }, { id: "visual-cold", name: "Cold bowls" }])),
  draft("small-plates", configuration("quantities", fixed(flat([0, 12, 5])))),
  draft("salad-selection", configuration("quantities", fixed(flat([12, 13])))),
];
const draftsById = new Map(drafts.map(menu => [menu.itemId, menu]));
const summaries = drafts.map(({ itemId, version, updatedAt, configuration }) => {
  const { schedule } = configuration;
  const common = { itemId, version, updatedAt, publicationStatus: "draft", hasPublishedRevision: false };
  return schedule.kind === "rotation" ? { ...common, kind: "rotation", cycleWeeks: schedule.weeks.length }
    : { ...common, kind: "fixed", dishCount: schedule.choices.dishes.length + schedule.choices.groups.reduce((sum, group) => sum + group.dishes.length, 0) };
});

const availableSites = index => sites.slice(0, index % 3 === 2 ? 2 : 3).map(site => site.id);
const isArchived = product => product.id === itemId("seasonal-soup");
const publicCatalogue = {
  schemaVersion: 2, contract: "fika.hospitality-catalogue-package.v2",
  items: products.flatMap(({ id, name, category, amount }, index) => isArchived({ id }) ? [] : [{
    id, name, category, description: "Fictional visual fixture product.",
    defaultPrices: [{ amount, vatRate: 0.2, from: fixtureDate }], defaultMinimumQuantity: 6,
    ...(availableSites(index).length !== sites.length && { allowedOplocIds: availableSites(index) }),
    dietaryInformation: [], allergenInformation: [],
  }]),
  oplocs: sites, exceptions: [],
};
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const plain = Buffer.from(JSON.stringify(publicCatalogue));
const gzip = gzipSync(plain);
const contentHash = sha256(gzip);
const dataset = "hospitality-booking/catalogue";
const manifest = {
  dataset, packageVersion: 1, schemaVersion: publicCatalogue.schemaVersion, contractVersion: publicCatalogue.contract,
  objectName: `${dataset}/${contentHash}.json.gz`, compression: "gzip", contentHash,
  compressedSize: gzip.length, uncompressedSize: plain.length,
  recordCount: publicCatalogue.items.length, generatedAt: fixtureTime,
};

const adminRows = products.map(({ id, name, category, amount }, index) => ({
  itemId: id, version: 2, name, category, description: "Fictional visual fixture product.",
  status: isArchived({ id }) ? "archived" : "active",
  routing: { state: "in_house", version: 1, workstreams: [] }, offerings: [],
  availableAt: isArchived({ id }) ? [] : availableSites(index),
  unavailableAt: sites.map(site => site.id).filter(siteId => isArchived({ id }) || !availableSites(index).includes(siteId)),
  defaultPrice: { amount, vatRate: 0.2, effectiveFrom: fixtureDate, priceId: "visual-price-" + index, version: 1 },
  defaultMinimumQuantity: 6, defaultMode: "standard", defaultConfiguration: { salesUnit: "portion" },
  overrideCount: 0, needsReview: [], sourceIds: [], providerMappings: [],
  dietaryInformation: [], allergenInformation: [], priceMigration: null,
}));
const admin = {
  generatedAt: fixtureTime, canManage: true, rows: adminRows,
  oplocs: sites.map(({ id, label }) => ({ oplocId: id, label, active: true })),
  reviewGroups: [], canonicalisation: { itemsAwaitingConsolidation: 0, mergeGroupsReady: 0, reviewGroups: 0 },
  counts: { active: adminRows.length - 1, archived: 1, needsReview: 0, routingRequired: 0 },
};
const adminVersion = "fictional-catalogue-head-1";
const customers = new Map(dishes.map(({ id, version, name, category, customerDescription }) =>
  [`${id}@${version}`, { id, version, name, category, customerDescription }]));

export const fixtureHash = sha256(JSON.stringify({ publicCatalogue, drafts, dishes, summaries, admin }));
const json = (value, headers) => ({ json: value, ...(headers && { headers }) });

export function visualResponse(url, method) {
  if (method !== "GET") return;
  const { pathname, searchParams: query } = url;
  if (pathname === "/api/studio/access") return { status: 204 };
  if (pathname === "/api/catalogue/public-package") return json(manifest);
  if (pathname === "/api/catalogue/public-package/" + contentHash) return { body: gzip, contentType: "application/octet-stream" };
  if (pathname === "/api/catalogue/version") return json({ schemaVersion: 1, version: adminVersion, canManage: true });
  if (pathname === "/api/catalogue") return json(admin, { "x-fika-catalogue-version": adminVersion });
  if (pathname === "/api/studio/product-menus") {
    if (query.has("dishRevisions")) return json({ items: query.get("dishRevisions").split(",").map(key => customers.get(key)).filter(Boolean) });
    if (query.has("itemId")) return json({ item: draftsById.get(query.get("itemId")) ?? null });
    return json({ items: summaries, nextCursor: null, ...(query.has("includeCatalogueManifest") && { catalogueManifest: manifest }) });
  }
  if (pathname === "/api/studio/product-preview") {
    const product = publicCatalogue.items.find(entry => entry.id === query.get("itemId"));
    const scope = { itemId: query.get("itemId"), siteId: query.get("siteId"), eventDate: query.get("eventDate"), draftOnly: true };
    if (!product || !sites.some(site => site.id === scope.siteId) || !scope.eventDate ||
        (product.allowedOplocIds && !product.allowedOplocIds.includes(scope.siteId))) return json({ ...scope, state: "unavailable" });
    return json({ ...scope, state: "priced", name: product.name, price: { amount: product.defaultPrices[0].amount, currency: "GBP", vatRate: 0.2 },
      minimumQuantity: 6, minimumGuests: 4, minimumDishQuantity: 1, supportedPresentations: ["dropdown", "quantities"] });
  }
  if (pathname === "/api/studio") {
    if (query.get("list") === "dishes") return json({ items: dishes, nextCursor: null });
    if (query.get("list") === "menus") return json({ items: [], nextCursor: null });
    if (query.get("list") === "assigned-dishes") {
      const ids = new Set(query.get("ids").split(","));
      return json({ items: dishes.filter(dish => ids.has(dish.id)) });
    }
  }
}
