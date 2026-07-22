const MENU_SUGGESTIONS = Object.freeze({
  mini_pastries: { serves: 12, unit: "trays" },
  sliced_fruit: { serves: 8, unit: "platters" },
  bagel_box: { serves: 12, unit: "boxes" },
  salad_box: { serves: 8, unit: "boxes" },
  exotic_fruit_20: { serves: 20, unit: "boxes" },
  exotic_fruit_8: { serves: 8, unit: "boxes" },
  tray_bakes: { serves: 4, unit: "boxes" },
  celebration_cake: { serves: 12, unit: "cakes" },
  loaf_cake: { serves: 10, unit: "cakes" },
  cheese_platter: { serves: 10, unit: "platters" },
  charcuterie: { serves: 10, unit: "platters" },
  bread_basket: { serves: 10, unit: "baskets" },
  nibble_bowls: { serves: 3, unit: "bowls" }
});

const MENU_SCHEMA = Object.freeze([
  menuItem_("mini_pastries", "Breakfast", "Mini Pastries", "A selection of mini Danish and bite-size chocolate muffins.", "Serves 12", 36, 1, null, 3, [], 10),
  menuItem_("yoghurt_pots", "Breakfast", "Yoghurt pot selection", "", "Per person", 3.5, 1, null, 3, [], 20),
  menuItem_("whole_fruit", "Breakfast", "Whole fruit pieces", "", "Per person", 1, 1, null, 3, [], 30),
  menuItem_("sliced_fruit", "Breakfast", "Fresh sliced fruit platter", "", "Serves 8", 20, 1, null, 3, [], 40),
  menuItem_("baps", "Breakfast", "Sausage or Bacon Baps", "", "Per person · minimum 10", 3.95, 10, null, 3, [
    choice_("filling", "Choose filling", "radio", true, ["Sausage", "Bacon", "Mixed", "Custom split"])
  ], 50),
  menuItem_("savoury_croissants", "Breakfast", "Savoury Filled Croissant", "", "Per person · minimum 12", 5, 12, null, 3, [
    choice_("filling", "Choose filling", "select", true, [
      "Swiss cheese, Wiltshire ham & vine tomato",
      "Free-range egg mayonnaise, sun blush tomato & roquette",
      "Smoked Chalk Stream trout, cream cheese & dill",
      "Mixed"
    ])
  ], 60),
  menuItem_("bagel_box", "Breakfast", "Bagels Box", "12 bagels, cut in half.", "Serves 12", 72, 1, null, 3, [
    choice_("filling", "Choose bagel selection", "select", true, [
      "Chapel Swan smoked trout, cream cheese & dill",
      "Crispy bacon & free-range egg mayonnaise",
      "Roasted red pepper, avocado & baby spinach"
    ])
  ], 70),
  menuItem_("apple_juice", "Breakfast", "Fresh squeezed Apple Juice", "", "Per person", 3.5, 1, null, 3, [], 80),
  menuItem_("orange_juice", "Breakfast", "Fresh squeezed Orange Juice", "", "Per person", 3.5, 1, null, 3, [], 90),
  menuItem_("carrot_juice", "Breakfast", "Fresh squeezed Carrot, Pear & Ginger", "", "Per person", 3.5, 1, null, 3, [], 100),
  menuItem_("still_water", "Breakfast", "Bottled Still Water 750ml", "", "Per bottle", 3.5, 1, null, 3, [], 110),
  menuItem_("sparkling_water", "Breakfast", "Bottled Sparkling Water 750ml", "", "Per bottle", 3.5, 1, null, 3, [], 120),

  menuItem_("deli_working_lunch", "Lunch", "Deli Style Working Lunch", "Meat, fish and vegetarian fillings on artisan breads; 3 pieces per person, vegetable crisps and whole fruit.", "Per person · minimum 8", 10.95, 8, 8, 3, [], 210),
  menuItem_("salad_box", "Lunch", "Salad Box", "", "1 box · serves 8", 25, 1, null, 3, [
    choice_("salad", "Choose salad", "select", true, ["Mediterranean", "Grilled Chicken Caesar", "Hot Smoked Salmon Niçoise"])
  ], 220),

  menuItem_("exotic_fruit_20", "Lunch Add-ons", "Exotic Fruit Box", "", "Per box · serves up to 20", 52.5, 1, null, 3, [], 300),
  menuItem_("exotic_fruit_8", "Lunch Add-ons", "Exotic Fruit Box", "", "Per box · serves up to 8", 20, 1, null, 3, [], 310),
  menuItem_("tray_bakes", "Lunch Add-ons", "Mini Tray-Bake Bites", "", "Per box · serves 4", 6, 1, null, 3, [], 320),
  menuItem_("cake_slice", "Lunch Add-ons", "Cake slice", "", "Per person", 3.5, 1, null, 3, [], 330),
  menuItem_("celebration_cake", "Lunch Add-ons", "Celebration Cake", "", "Per cake · serves 12", 27, 1, null, 3, [], 340),
  menuItem_("loaf_cake", "Lunch Add-ons", "Loaf Cake", "", "Per cake · serves 10", 20, 1, null, 3, [], 350),

  menuItem_("canapes", "Events Catering", "Canapés", "Six pieces per person. Final selections are confirmed with the hospitality team.", "Per person · minimum 20 guests", 30, 20, 20, 10, [], 400),
  menuItem_("bowl_food", "Events Catering", "Bowl Food", "Three bowls per person. Final selections are confirmed with the hospitality team.", "Per person · minimum 20 guests", 30, 20, 20, 10, [], 410),
  unavailableItem_("summer_rolls", "Events Catering", "Summer Rolls", "12 wraps per platter, one flavour per platter. Price to be confirmed.", "Per platter", 10, 420),
  menuItem_("classic_buffet", "Events Catering", "Classic Buffet", "Sausage rolls, Scotch eggs, pork pies, chicken skewers, tomato quiche, savoury nibbles and tray-bake bites.", "Per person", 18, 1, null, 10, [], 430),
  menuItem_("picnic_grazing", "Events Catering", "Picnic Grazing Table", "British charcuterie, artisan breads, crudités, falafel, hummus and a British county cheese board.", "Per person · minimum 50 guests", 24.95, 50, 50, 10, [], 440),

  menuItem_("cheese_platter", "Add-ons", "Cheese Platter", "British county cheeses, chutney and artisan biscuits.", "Per platter · feeds 10", 75, 1, null, 3, [], 500),
  menuItem_("charcuterie", "Add-ons", "Charcuterie Platter", "British charcuterie, olives, sun blush tomatoes, gherkins, peppers and artisan breads.", "Per platter · feeds 10", 75, 1, null, 3, [], 510),
  menuItem_("bread_basket", "Add-ons", "Bread basket", "A selection of freshly baked bread.", "Per basket · serves 10", 15, 1, null, 3, [], 520),
  menuItem_("nibble_bowls", "Add-ons", "Nibble bowls", "", "Per bowl · serves 3 · minimum 3", 2, 3, null, 3, [
    choice_("flavour", "Choose nibbles", "multi", true, [
      "Spicy chilli crackers",
      "Salted pretzels",
      "Sea salted crisps",
      "Goat's cheese & black pepper popcorn",
      "Mini salsa baguettes"
    ])
  ], 530),

  menuItem_("standard_bbq", "Summer BBQ Catering", "Standard BBQ", "Beef and cheddar burger, plant-based burger, Cajun chicken, halloumi skewers and seasonal sides.", "Per person · minimum 100 guests", 25, 100, 100, 10, [], 600),
  menuItem_("premium_bbq", "Summer BBQ Catering", "Premium BBQ", "Beef and cheddar burger, plant-based burger, smoked ribs, catch of the day, halloumi skewers and seasonal sides.", "Per person · minimum 100 guests", 32.5, 100, 100, 10, [], 610),

  wineItem_("white_macabeo", "White Wine", "Organic Macabeo, Familia Castaño, Murcia, Spain", 27, 700),
  wineItem_("white_vinho_verde", "White Wine", "Vinho Verde Loureiro/Alvarinho, Quinta de Azevedo, Portugal", 31, 710),
  wineItem_("white_picpoul", "White Wine", "Picpoul de Pinet, Domaine La Croix Gratiot, Languedoc, France", 34, 720),
  wineItem_("red_monastrell", "Red Wine", "Organic Monastrell, Familia Castaño, Murcia, Spain", 27, 730),
  wineItem_("red_nero_davola", "Red Wine", "Nero d'Avola, Mandrarossa, Sicily, Italy", 32, 740),
  wineItem_("red_malbec", "Red Wine", "Mendoza Malbec Clásico Organic, Altos Las Hormigas, Argentina", 36, 750),
  wineItem_("rose_rosado", "Rosé Wine", "Organic Rosado, Familia Castaño, Murcia, Spain", 27, 760),
  wineItem_("rose_touraine", "Rosé Wine", "Touraine Rosé, Domaine de La Brossette, Loire, France", 35, 770),
  wineItem_("sparkling_prosecco", "Sparkling Wine", "NV Monopolio Prosecco Spumante Organic, Cantina di Gambellara, Veneto, Italy", 32, 780),
  wineItem_("sparkling_blanc", "Sparkling Wine", "2022 Blanc de Blancs, Raventós i Blanc, Cataluña, Spain", 37, 790),
  wineItem_("sparkling_rathfinny", "Sparkling Wine", "2019 Classic Cuvée Brut, Rathfinny Wine Estate, Sussex, England", 60, 800),

  menuItem_("soft_drinks", "Drinks & Packages", "Soft Drinks", "Mixed flavours including Coke, Diet Coke, Fanta, Sprite, kombucha and Dash water.", "Per can", 2.5, 1, null, 3, [], 900),
  menuItem_("bottled_beer", "Drinks & Packages", "Bottled Beer", "Peroni, Estrella or similar.", "Per bottle", 5, 1, null, 10, [], 910),
  menuItem_("zero_beer", "Drinks & Packages", "0% Bottled Beer", "", "Per bottle", 5, 1, null, 10, [], 920),
  menuItem_("drinks_package", "Drinks & Packages", "1 Hour drinks package", "Beer, house wine, soft drinks and water.", "Per person", 15, 1, null, 10, [], 930)
]);

function menuItem_(id, category, name, description, servingInfo, unitPrice, minimumQuantity, minimumGuests, noticeRequiredDays, choices, sortOrder) {
  const suggestion = MENU_SUGGESTIONS[id] || {};
  return Object.freeze({
    id: id,
    category: category,
    name: name,
    description: description,
    servingInfo: servingInfo,
    unitPrice: unitPrice,
    priceType: "per_item",
    minimumQuantity: minimumQuantity,
    minimumGuests: minimumGuests,
    noticeRequiredDays: noticeRequiredDays,
    serves: suggestion.serves || null,
    suggestionType: suggestion.serves ? "ceil_by_guests" : null,
    suggestionLabel: suggestion.serves ? "Suggested for your guest count" : "",
    suggestionUnit: suggestion.unit || "units",
    choices: choices || [],
    dietaryTags: [],
    allergens: [],
    available: true,
    sortOrder: sortOrder
  });
}

function wineItem_(id, category, name, price, sortOrder) {
  return menuItem_(id, category, name, "", "Per bottle", price, 1, null, 10, [], sortOrder);
}

function unavailableItem_(id, category, name, description, servingInfo, noticeRequiredDays, sortOrder) {
  const item = menuItem_(id, category, name, description, servingInfo, 0, 1, null, noticeRequiredDays, [], sortOrder);
  return Object.freeze(Object.assign({}, item, { available: false }));
}

function choice_(id, label, type, required, options) {
  return Object.freeze({ id: id, label: label, type: type, required: required, options: options });
}
