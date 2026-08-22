function clean(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "untitled";
}

export function productionItemId(title: string, parentMenuItemKey?: string) {
  return `sandwich:${clean(parentMenuItemKey?.trim() || "global")}:${clean(title)}`;
}
