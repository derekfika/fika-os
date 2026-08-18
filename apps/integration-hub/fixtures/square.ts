export const squareFixture = {
  locations: [
    { id: "square-location-synthetic-001", name: "Synthetic Riverside Till", status: "ACTIVE", updated_at: "2026-07-01T09:00:00Z", address: { address_line_1: "1 Example Walk", locality: "London" } },
    { id: "square-location-synthetic-archive", name: "Synthetic Historic Till", status: "INACTIVE", updated_at: "2025-01-01T09:00:00Z" },
  ],
  objects: [
    { type: "CATEGORY", id: "square-category-synthetic-001", version: 2, updated_at: "2026-07-01T09:00:00Z", category_data: { name: "Hot Drinks" } },
    { type: "ITEM", id: "square-item-synthetic-001", version: 5, updated_at: "2026-07-02T09:00:00Z", item_data: { name: "Synthetic Flat White", description_plaintext: "Synthetic espresso with steamed milk", abbreviation: "SFW", product_type: "REGULAR", available_online: true, available_for_pickup: true, category_id: "square-category-synthetic-001", tax_ids: ["square-tax-synthetic-001"], modifier_list_info: [{ modifier_list_id: "square-modifier-list-synthetic-001" }], variations: [{ type: "ITEM_VARIATION", id: "square-variation-synthetic-001", version: 6, updated_at: "2026-07-02T09:00:00Z", item_variation_data: { item_id: "square-item-synthetic-001", name: "Regular", sku: "SYN-FW-R", pricing_type: "FIXED_PRICING", sellable: true, stockable: true, price_money: { amount: 350, currency: "GBP" }, location_overrides: [{ location_id: "square-location-synthetic-001", price_money: { amount: 375, currency: "GBP" }, sold_out: false }] }, present_at_all_locations: false, present_at_location_ids: ["square-location-synthetic-001"] }] } },
    { type: "MODIFIER_LIST", id: "square-modifier-list-synthetic-001", version: 1, modifier_list_data: { name: "Milk", modifiers: [{ type: "MODIFIER", id: "square-modifier-synthetic-001", modifier_data: { name: "Oat" } }] } },
    { type: "TAX", id: "square-tax-synthetic-001", version: 1, tax_data: { name: "VAT", percentage: "20" } },
  ],
};
