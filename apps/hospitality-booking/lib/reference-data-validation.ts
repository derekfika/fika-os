export function isFinitePrice(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function filterPricedMenu<T extends { unitPrice?: unknown }>(items: T[]) {
  return items.filter((item): item is T & { unitPrice: number } =>
    isFinitePrice(item.unitPrice),
  );
}
