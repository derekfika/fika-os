const categoriesWithoutDishChoices = new Set(["drink", "drinks", "beverage", "beverages", "wine", "wines"]);

/** Standalone beverage products do not have a dish menu to author. */
export function menuChoicesForCategory(category: string): boolean {
  return !categoriesWithoutDishChoices.has(category.trim().toLocaleLowerCase("en-GB"));
}

export function filterMenuBuilderProducts<T extends { itemId: string; name: string; category: string }>(
  products: T[], configuredIds: ReadonlySet<string>, query: string, status: "all" | "published" | "draft" | "not-configured",
  publishedIds: ReadonlySet<string>,
) {
  const needle = query.trim().toLocaleLowerCase("en-GB");
  return products.filter((product) => {
    const configured = configuredIds.has(product.itemId);
    return (status === "all" || status === "draft" && configured && !publishedIds.has(product.itemId) ||
      status === "published" && publishedIds.has(product.itemId) || status === "not-configured" && !configured) &&
      (!needle || `${product.name} ${product.category}`.toLocaleLowerCase("en-GB").includes(needle));
  });
}
