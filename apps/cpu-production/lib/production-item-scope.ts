export const DELI_STYLE_PARENT_KEY = "deli-style-sandwich-lunch";
export const DELIVERED_IN_LUNCH_PARENT_KEY = "delivered-in-lunch";

export function productionParentKey(name: string) {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function isDeliStyleParent(name: string) {
  const key = productionParentKey(name);
  return key === DELI_STYLE_PARENT_KEY || key.includes("deli-style-sandwich");
}

export function isDeliveredInLunchParent(name: string) {
  return productionParentKey(name) === DELIVERED_IN_LUNCH_PARENT_KEY;
}

export function scopeProductionItems<T extends { parentMenuItemKey?: string }>(items: T[], parentName: string) {
  const key = isDeliStyleParent(parentName)
    ? DELI_STYLE_PARENT_KEY
    : isDeliveredInLunchParent(parentName)
      ? DELIVERED_IN_LUNCH_PARENT_KEY
      : null;
  return key ? items.filter((item) => item.parentMenuItemKey === key) : [];
}
