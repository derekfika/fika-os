/** Stable identity for a saved production item within its menu parent. */
export function productionItemId(title: string, parentMenuItemKey?: string) {
  const slug = (value: string) =>
    value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "untitled";
  return `sandwich:${slug(parentMenuItemKey || "global")}:${slug(title)}`;
}

export function legacyProductionItemId(title: string) {
  const slug = title.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "untitled";
  return `sandwich:${slug}`;
}
