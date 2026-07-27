const MENU_SUGGESTIONS = Object.freeze({
  mini_pastries: { serves: 12, unit: "boxes" },
  large_pastries: { serves: 12, unit: "boxes" },
  filled_savoury_croissant: { serves: 12, unit: "boxes" },
  vegan_savoury_croissant: { serves: 12, unit: "boxes" },
  bagel_box: { serves: 12, unit: "boxes" },
  exotic_fruit_box: { serves: 20, unit: "boxes" },
  rice_paper_rolls: { serves: 3, unit: "platters" },
  grazing_charcuterie_box: { serves: 10, unit: "boxes" },
  cheese_box: { serves: 10, unit: "boxes" },
  picnic_box: { serves: 10, unit: "boxes" },
  vegan_box: { serves: 10, unit: "boxes" },
  salad_boxes: { serves: 8, unit: "boxes" },
  deluxe_sushi_box: { serves: 10, unit: "boxes" },
  vegan_sushi_box: { serves: 10, unit: "boxes" }
});

const MENU_SCHEMA = Object.freeze([
  menuItem_("house_filter_coffee", "Drinks", "House Filter Coffee", "Filter coffee, served per person.", "Per person", 3, 1, null, 3, [], 10),
  menuItem_("specialty_tea_coffee", "Drinks", "Specialty Tea & Coffee", "Specialty teas and coffee, served per person.", "Per person", 3.5, 1, null, 3, [], 20),
  menuItem_("belu_water", "Drinks", "Belu Water Bottle", "750ml still or sparkling mineral water. All profits go to WaterAid.", "Per bottle", 3.95, 1, null, 3, [
    choice_("water", "Choose water", "select", true, ["Still", "Sparkling", "Mixed"])
  ], 30),
  menuItem_("canned_drinks", "Drinks", "A Selection of Canned Drinks", "Coke, Diet Coke, Coke Zero, Sprite and Fanta Orange.", "Per can", 1.75, 1, null, 3, [], 40),
  menuItem_("fresh_juice_250", "Drinks", "Fresh Squeezed & Pressed Juice", "250ml bottle. Orange, seasonal apple, carrot pear & ginger, or seasonal blood orange.", "Per bottle", 3, 1, null, 3, [
    choice_("flavour", "Choose flavour", "select", true, ["Orange", "Seasonal apple", "Carrot, pear & ginger", "Blood orange (seasonal)", "Mixed"])
  ], 50),
  menuItem_("fresh_juice_1l", "Drinks", "Fresh Squeezed & Pressed Juice", "1L bottle. Orange, seasonal apple, carrot pear & ginger, or seasonal blood orange.", "Per bottle", 9, 1, null, 3, [
    choice_("flavour", "Choose flavour", "select", true, ["Orange", "Seasonal apple", "Carrot, pear & ginger", "Blood orange (seasonal)", "Mixed"])
  ], 60),
  menuItem_("ginger_shot", "Drinks", "Fresh Pressed Ginger, Turmeric & Lemon Shot", "", "80ml shot", 3, 1, null, 3, [], 70),
  menuItem_("smoothie_1l", "Drinks", "Freshly Made Smoothie", "1L bottle. Green Glow, Berry Boost or Island Breeze.", "Per bottle", 12, 1, null, 3, [
    choice_("flavour", "Choose flavour", "select", true, ["Green Glow", "Berry Boost", "Island Breeze", "Mixed"])
  ], 80),

  menuItem_("cookie_box", "Sweet treats", "Freshly Baked Cookie Box", "24 freshly baked mixed cookies including milk chocolate, double chocolate, white chocolate, chocolate chip and Carnivals Smarties cookies.", "Box of 24", 40, 1, null, 3, [], 100),
  menuItem_("tray_bake_box", "Sweet treats", "Tray Bake Box", "Medium box contains 24 pieces and can be cut into 48 smaller bites. Example flavours include caramel Rolo brownie, caramelised biscuit brownie, raspberry & white chocolate blondies, and lemon & white chocolate blondies.", "Box of 24 pieces", 75, 1, null, 3, [], 110),
  menuItem_("exotic_fruit_box", "Breakfast", "Exotic Fruit Box", "Watermelon, cantaloupe melon, honey dew melon, pineapple, kiwi, passion fruit and strawberries.", "Serves 20 people", 52.5, 1, null, 3, [], 120),
  menuItem_("mini_pastries", "Breakfast", "Mini Pastries", "A selection of two mini Danish and bite-size chocolate muffins per person, garnished with strawberries and icing sugar.", "Box feeds 12 people", 36, 1, null, 3, [], 130),
  menuItem_("large_pastries", "Breakfast", "Freshly Baked Large Pastries", "Four plain croissants, four raspberry croissants and four almond croissants.", "Box of 12 pastries", 42, 1, null, 3, [], 140),
  menuItem_("filled_savoury_croissant", "Breakfast", "Filled Savoury Croissant", "Four Swiss cheese, Wiltshire ham & vine tomato; four free-range egg mayonnaise, sun blush tomato & roquette; four smoked Chalk Stream trout, cream cheese & dill.", "Box of 12 pastries", 60, 1, null, 3, [], 150),
  menuItem_("vegan_savoury_croissant", "Breakfast", "Vegan Savoury Croissant", "Four smashed avocado & sun blushed tomatoes; four smoked Applewood cheese, green tomato chutney & roquette; four roast portobello mushroom, baby spinach & vegan feta.", "Box of 12 pastries", 65, 1, null, 3, [], 160),
  menuItem_("bagel_box", "Breakfast", "Bagel Box", "12 bagels cut in half. Choose smoked trout, crispy bacon & egg mayonnaise, roasted red pepper with smashed avocado, or mixed.", "12 bagels cut in half", 72, 1, null, 3, [
    choice_("selection", "Choose bagel selection", "select", true, ["Chapel Swan smoked trout, soft cream cheese & dill", "Crispy bacon & free range egg mayonnaise", "Roasted red pepper, smashed avocado & baby spinach", "Mixed"])
  ], 170),
  menuItem_("breakfast_pots", "Breakfast", "Breakfast Pots", "Weekly changing menu. Options include fruit salad, Greek yoghurt, vegan yoghurt, free range boiled egg & baby spinach, smashed avocado with smoked salmon and egg, or overnight oats.", "Per pot - minimum 12 per item", 3.95, 12, null, 3, [
    choice_("pot", "Choose pot", "select", true, ["Fruit salad", "House made Greek yoghurt", "Vegan yoghurt", "Free range boiled egg & baby spinach", "Smashed avocado, smoked salmon & free range boiled egg", "Overnight oats", "Mixed"])
  ], 180),
  menuItem_("healthy_plant_power_breakfast", "Breakfast", "Healthy Plant Power Breakfast", "Example menu includes seasonal poached fruit with coconut chia, vegan banana bread, sourdough crostini with smashed avocado, flapjack and fresh ginger shot.", "Per person", 22, 1, null, 3, [], 190),

  menuItem_("deli_sandwich_lunch", "Lunch", "Deli Style Sandwich Lunch", "Three pieces per person. Meat, fish and vegetarian fillings on artisan breads such as ciabatta, focaccia, baguettes and wraps, served with hand cooked vegetable crisps.", "Per person", 9, 8, 8, 3, [], 200),
  menuItem_("individual_boxed_lunch", "Lunch Boxes", "Individual Boxed Lunch", "Deli style sandwich, pasta salad, vegetable crisps, sausage roll and mini traybake. Vegan and gluten-free available on request.", "Per person", 14.95, 8, 8, 3, [], 210),
  menuItem_("salad_protein_lunch_platter", "Lunch", "Salad & Protein Lunch Platter", "Three composite salads plus one meat protein, one fish protein and one veggie or vegan protein.", "Per person", 14, 8, 8, 3, [], 220),
  menuItem_("rice_paper_rolls", "Lunch", "Freshly Wrapped Rice Paper Rolls", "12 wraps per platter, each platter contains one flavour with dipping sauce.", "Feeds 3", 45, 1, null, 3, [
    choice_("flavour", "Choose flavour", "multi", true, ["Crayfish and avocado", "Hot smoked trout", "Char-siu pulled chicken", "Lemongrass, ginger & chilli chicken", "Rainbow vegetable roll (vegan)", "Hoisin tofu and rainbow veg (vegan)"])
  ], 230),
  menuItem_("grazing_charcuterie_box", "Grazing Boxes", "Grazing Box - Charcuterie", "Cobble Lane cured British charcuterie, Gordal olives, sun blush tomatoes, baby gherkins, stuffed cherrybell peppers, artisan breads, olive oil and balsamic.", "Feeds 10", 75, 1, null, 3, [], 240),
  menuItem_("cheese_box", "Grazing Boxes", "Cheese Box", "British county cheeses including Wookey Hole Cheddar, Colston Bassett Stilton, Hampshire Tunworth and Cornish Yarg in nettles with Stokes beer chutney and artisan biscuits.", "Feeds 10", 75, 1, null, 3, [], 250),
  menuItem_("picnic_box", "Grazing Boxes", "Picnic Box", "Freshly baked sausage rolls, Scotch eggs, pork pies, chicken skewers and tomato quiche with Stokes beer chutney and red onion marmalade.", "Feeds 10", 75, 1, null, 3, [], 260),
  menuItem_("vegan_box", "Grazing Boxes", "Vegan Box", "Vegan mezze with rainbow radish, cucumber and carrot shards, edamame beans, sweet potato falafel, olives, little gem spears, cherry tomatoes, pickles, toasted pita and three hummus flavours.", "Feeds 10", 60, 1, null, 3, [], 270),
  menuItem_("salad_boxes", "Salads & Sushi", "Salad Boxes", "Mediterranean, grilled chicken Caesar, hot smoked salmon Nicoise, or weekly salad box on request.", "Feeds 8 as a side", 25, 1, null, 3, [
    choice_("salad", "Choose salad", "select", true, ["Mediterranean", "Grilled chicken Caesar", "Hot smoked salmon Nicoise", "Weekly salad box"])
  ], 280),
  menuItem_("weekly_salad_box", "Salads & Sushi", "Weekly Salad Box", "Weekly salad boxes available. Menu on request.", "Per box", 20, 1, null, 3, [], 290),
  menuItem_("deluxe_sushi_box", "Salads & Sushi", "Deluxe Sushi Box", "84 pieces. Mixed selection of nigiri, maki and uramaki served with pickled ginger, wasabi and soy.", "Feeds 8 to 12 people", 160, 1, null, 3, [], 300),
  menuItem_("vegan_sushi_box", "Salads & Sushi", "Vegan Sushi Box", "72 pieces. Mixed plant based selection of nigiri, maki and uramaki served with pickled ginger, wasabi and soy.", "Feeds 8 to 12 people", 120, 1, null, 3, [], 310),
  menuItem_("glow_bowl", "Salads & Sushi", "FIKA Glow Bowl", "Individual salad bowl. Choose avocado Mex, sweet potato & quinoa, Mediterranean veg, or Asian prawn & edamame.", "Per person", 12.95, 8, 8, 3, [
    choice_("bowl", "Choose bowl", "select", true, ["Avocado Mex Bowl", "Sweet Potato & Quinoa Bowl", "Mediterranean Veg Bowl", "Asian Prawn & Edamame Bowl", "Mixed"])
  ], 320),

  menuItem_("picnic_grazing_table", "Grazing Events", "Picnic Grazing Table", "British charcuterie, sausage rolls, olives, breads, crudites, falafel, hummus, British county cheese board, artisan biscuits and fresh cut fruit.", "Per person - minimum 20", 24.95, 20, 20, 7, [], 400),
  menuItem_("grazing_sweet_table", "Grazing Events", "Grazing Sweet Table", "Lemon mousse, tiramisu coffee shots, mini pavlova, salted caramel canelles, mini passion fruit meringue pies and macaroon tower.", "Per person - minimum 20", 18.95, 20, 20, 7, [], 410),
  menuItem_("grazing_cups", "Grazing Events", "Grazing Cups", "Individual cups with charcuterie, cheese with olives and crisp breads, falafel and dried fruit, and pretzels.", "Per person - minimum 30 cups", 12.95, 30, 30, 7, [], 420),
  menuItem_("afternoon_tea", "Afternoon", "Afternoon Tea", "Three bridge rolls from six fillings, colourful macaroon, salted caramel canelles, lemon mousse, Black Forest gateau, passion fruit meringue, and teas with milk and cream.", "Per person", 21.95, 8, 8, 3, [], 430),
  menuItem_("finger_food", "Finger Food", "Finger Food", "Minimum recommended four pieces per person. Choose meat, fish, vegetarian, vegan and dessert options from the brochure selection.", "Per piece", 3.95, 4, null, 3, [
    choice_("selection", "Selection style", "select", true, ["Mixed brochure selection", "Meat focused", "Fish focused", "Vegetarian focused", "Vegan focused", "Dessert focused"])
  ], 440),
  menuItem_("hot_fork_buffet_gold", "Fork Buffet & Bowl Food", "Hot Fork Buffet - Gold Package", "Meat, fish, vegan, two sides, four salads and one dessert. Menu on request.", "Per person", 28, 12, 12, 7, [], 450),
  menuItem_("hot_fork_buffet_silver", "Fork Buffet & Bowl Food", "Hot Fork Buffet - Silver Package", "Meat, vegan, two sides and four salads. Menu on request.", "Per person", 20, 12, 12, 7, [], 460),
  menuItem_("bowl_food", "Fork Buffet & Bowl Food", "Bowl Food", "Three bowls per person. Example menu includes chorizo jambalaya, plant based cumin lamb meatball tagine and hot smoked salmon Caesar salad.", "Per person", 30, 20, 20, 7, [], 470),
  menuItem_("canapes", "Canapes", "FIKA Canapes", "Six items per person. Hot canapes can only be offered on sites with an oven or a hire charge.", "Per person - minimum 20", 30, 20, 20, 7, [], 480),
  menuItem_("corporate_dining", "Dining", "FIKA Corporate Dining", "Bespoke seated dining menus served with homemade focaccia and flavoured butters. One menu per booking.", "Per person - minimum 12", 45, 12, 12, 7, [], 490),
  menuItem_("christmas_themed_menu", "Bespoke Events", "Example Christmas Themed Menu", "Roast turkey with trimmings, butternut squash wellington, roast potatoes, honey glazed roots, Brussels sprouts, chocolate orange cheesecake, mince pies and brandy cream.", "Per person - minimum 50 - from price", 25, 50, 50, 10, [], 500),
  menuItem_("bespoke_event", "Bespoke Events", "Bespoke Event Menu", "For Thanksgiving, Christmas, Valentine's Day or other themed events. The team will create a tailored proposal.", "Price on request", 0, 1, null, 7, [], 510)
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

function choice_(id, label, type, required, options) {
  return Object.freeze({ id: id, label: label, type: type, required: required, options: options });
}
