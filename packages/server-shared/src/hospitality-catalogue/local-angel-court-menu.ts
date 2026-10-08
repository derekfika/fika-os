import type {
  HospitalityMenuCatalogue,
  HospitalityMenuItem,
} from "./hospitality-menu-catalogue";

const sourceRows: Array<[string, string, string, number, string]> = [
  ["mini-pastries", "Mini Pastries", "Breakfast", 36, "Feeds 12 people"],
  ["yoghurt-pots", "Yoghurt pot selection", "Breakfast", 3.5, "Per person"],
  ["whole-fruit-bowl", "Whole fruit bowl", "Breakfast", 2, "Per person"],
  [
    "fresh-fruit-platter",
    "Fresh sliced fruit platter",
    "Breakfast",
    20,
    "Serves 8",
  ],
  [
    "breakfast-baps",
    "Sausage or Bacon Breakfast Baps",
    "Breakfast",
    3.95,
    "Per person · minimum 10",
  ],
  [
    "savoury-croissants",
    "Savoury filled croissants",
    "Breakfast",
    5,
    "Per person · minimum 12",
  ],
  ["bagel-box", "Bagel Box", "Breakfast", 72, "12 bagels cut in half"],
  ["soft-drinks", "Soft drinks", "Drinks", 2, "Per person"],
  ["fresh-juice", "Fresh squeezed or pressed juice", "Drinks", 3, "Per person"],
  ["water", "Bottled still or sparkling water", "Drinks", 3.5, "750ml"],
  [
    "deli-style-sandwich",
    "Deli Style Sandwich",
    "Lunch",
    10.95,
    "Per person · minimum 10",
  ],
  ["salad-boxes", "Salad Boxes", "Lunch", 25, "Medium box serves 8"],
  [
    "exotic-fruit-box",
    "Exotic Fruit Box",
    "Sweet treats",
    52.5,
    "Medium box feeds up to 20",
  ],
  ["mini-traybake-bites", "Mini traybake bites", "Sweet treats", 6, "Serves 4"],
  ["cake-slice", "Cake slice", "Sweet treats", 3.5, "Per person"],
  ["fika-canapes", "Fika Canapes", "Canapes", 30, "Per person · 6 items"],
  [
    "fika-bowl-food",
    "Fika Bowl Food",
    "Bowl & Finger Food",
    30,
    "Per person · 3 bowls",
  ],
  [
    "finger-food",
    "Finger Food",
    "Bowl & Finger Food",
    3.95,
    "Per piece · minimum 12",
  ],
  ["wrapped", "Wrapped", "Summer Rolls", 30, "Per platter · 12 wraps"],
  ["classic-buffet", "Classic Buffet", "Buffet", 18, "Per person · minimum 50"],
  ["cheese-platter", "Cheese Platter", "Buffet", 75, "Feeds 10"],
  ["charcuterie-platter", "Charcuterie Platter", "Buffet", 75, "Feeds 10"],
  ["bread-basket", "Bread basket", "Buffet", 15, "Serves 10"],
  ["nibble-bowls", "Nibble bowls", "Buffet", 2, "Per bowl · serves 3"],
  [
    "picnic-grazing-table",
    "Picnic Grazing Table",
    "Buffet",
    24.95,
    "Per person · minimum 20",
  ],
  ["standard-bbq", "Standard BBQ", "Summer BBQ", 25, "Per person · minimum 20"],
  ["premium-bbq", "Premium BBQ", "Summer BBQ", 32.5, "Per person · minimum 20"],
];

// Descriptions are transcribed from the Angel Court hospitality brochure.
// Keep the catalogue fallback for entries where the brochure supplies no
// useful descriptive copy, rather than inventing ingredients or dietary data.
const brochureDescriptions: Record<string, string> = {
  "mini-pastries":
    "A selection of mini Danish and bite-size chocolate muffins. Garnish with cut strawberries and icing sugar.",
  "savoury-croissants":
    "Swiss cheese, Wiltshire ham and vine tomato; free-range egg mayonnaise, sun blush tomato and roquette; or smoked Chalk Stream trout, cream cheese and dill.",
  "bagel-box":
    "12 bagels, cut in half. Choose from Chapel Swan smoked trout, soft cream cheese and dill; crispy bacon and free-range egg mayonnaise; or roasted red pepper, smashed avocado and baby spinach.",
  "soft-drinks": "Coke, Diet Coke, Coke Zero and Sprite.",
  "fresh-juice":
    "Fresh squeezed orange juice, apple juice or carrot, pear and ginger.",
  "deli-style-sandwich":
    "A selection of meat, fish and vegetarian fillings on artisan breads such as ciabatta, focaccia, baguettes and wraps. Three pieces per person, with hand-cooked vegetable crisps and whole fruit pieces. Sandwich platters come in separate meat, fish, vegetarian or vegan boxes.",
  "salad-boxes":
    "Choose from Mediterranean, grilled chicken Caesar or hot smoked salmon Niçoise salad boxes.",
  "exotic-fruit-box":
    "Watermelon, cantaloupe melon, honeydew melon, pineapple, kiwi, passion fruit and strawberries.",
  "mini-traybake-bites": "Brownie, brookies, caramel shortbread and blondies.",
  "fika-canapes":
    "Six pieces per person. Final selections are confirmed with the hospitality team.",
  "fika-bowl-food":
    "Three individual mini bowls per person. Final selections are confirmed with the hospitality team.",
  "finger-food":
    "A selection of meat, fish, vegetarian, vegan and dessert finger food, available as individual pieces.",
  wrapped:
    "Clean-eating salads wrapped in delicate rice paper, each with its own dipping sauce. Twelve wraps per platter, with one flavour per platter.",
  "classic-buffet":
    "Freshly baked sausage rolls, Scotch eggs, pork pies, chicken skewers and tomato quiche, with Stokes beer chutney, red onion marmalade, salted pretzels, sea salt crisps, spicy chilli crackers, hand-cooked vegetable crisps and sweet tray-bake bites.",
  "cheese-platter":
    "A selection of British county cheeses including Wookey Hole Cheddar, Colston Basset Stilton, Hampshire Tunworth and Cornish Yarg wrapped in nettles, with Stokes beer chutney and artisan biscuits.",
  "charcuterie-platter":
    "A selection of Cobble Lane cured British charcuterie, Gordal olives, sun blush tomatoes, baby gherkins, stuffed cherrybell peppers, artisan breads, olive oil and balsamic.",
  "bread-basket": "A selection of freshly baked bread to serve 10 people.",
  "nibble-bowls":
    "Spicy chilli crackers, salted pretzels, sea salted crisps, goat's cheese and black pepper popcorn, or mini salsa baguettes.",
  "picnic-grazing-table":
    "Cobble Lane cured British charcuterie, artisan sausage rolls, Gordal olives, sun-blushed tomatoes, baby gherkins, stuffed cherry bell peppers, artisan breads, seasonal crudités, falafel and house hummus, with a British county cheese board and fresh-cut fruit.",
  "standard-bbq":
    "Beef and mature cheddar brioche burger, plant-based brioche burger, Cajun quarter chicken leg, halloumi and roasted vegetable skewers, chargrilled corn on the cob, baby new potato salad, garden salad and coleslaw.",
  "premium-bbq":
    "Beef and mature cheddar brioche burger, plant-based brioche burger, smoked ribs with BBQ glaze, chargrilled catch of the day, halloumi and roasted vegetable skewers, chargrilled corn on the cob, baby new potato salad, garden salad and coleslaw.",
};

const items: HospitalityMenuItem[] = sourceRows.map(
  ([sourceItemId, name, category, unitPrice, servingInfo], index) => ({
    canonicalId: `hospitality-menu-item:angel-court:${sourceItemId}`,
    source: {
      provider: "angel-court-hospitality-brochure",
      sourcePath: "New Brochure Angel Court_Hospitality_2026.pptx",
      sourceItemId,
    },
    name,
    description:
      brochureDescriptions[sourceItemId] ||
      "Published from the Angel Court hospitality brochure source; confirm availability and dietary detail during review.",
    category,
    pricing: {
      unitPrice,
      currency: "GBP",
      basis: "per person or stated serving basis",
      servingInfo,
      vatRate: null,
    },
    orderingConstraints: {
      minimumQuantity: Math.max(
        sourceItemId === "wrapped" ? 3 : 1,
        Number(servingInfo.match(/minimum\s+(\d+)/i)?.[1] || 1),
      ),
      minimumGuests: null,
      noticeRequiredDays:
        category === "Canapes" ||
        category === "Bowl & Finger Food" ||
        category === "Summer Rolls" ||
        category === "Buffet" ||
        category === "Summer BBQ"
          ? 10
          : 3,
      serves: null,
      suggestionType: null,
      suggestionLabel: servingInfo,
      suggestionUnit: "serving",
    },
    optionGroups: [],
    dietaryInformation: [],
    allergenInformation: [],
    lifecycleState: "active",
    sortOrder: index,
  }),
);

export const localAngelCourtMenuCatalogue: HospitalityMenuCatalogue = {
  schemaVersion: "fika.hospitality-menu-catalogue.v1",
  generatedAt: "2026-08-05T00:00:00.000Z",
  source: {
    path: "New Brochure Angel Court_Hospitality_2026.pptx",
    itemCount: items.length,
  },
  categories: [...new Set(items.map((item) => item.category))].map((name) => ({
    canonicalId: `hospitality-menu-category:angel-court:${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    name,
  })),
  items,
  validationReport: {
    sourceItemCount: items.length,
    generatedItemCount: items.length,
    missingCanonicalFields: [
      {
        field: "dietaryInformation",
        reason: "Not supplied as structured data by the brochure source",
      },
      {
        field: "allergenInformation",
        reason: "Not supplied as structured data by the brochure source",
      },
    ],
  },
};
