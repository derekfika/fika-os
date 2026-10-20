/** Shared browser/Hub catalogue rules. Pure: no I/O or side effects. */
export type CatalogueRules = {
  guestMinimumKind?: "event" | "product";
  noticeHours?: number;
  indicativeFrom?: number;
  parentItemId?: string;
  parentQuantity?: "same" | "at_most";
  salesUnit?: string;
  productionConversion?: { multiplier: number; unit: string };
};
export type CatalogueChoice = { id: string; label: string; controlType?: string; selectionType?: string; required?: boolean; minimumQuantity?: number; options: Array<{ id: string; label: string }> };
export type RuleItem = { quoteRequired?: boolean; id: string; name: string; minimumQuantity?: number; minimumGuests?: number; configuration?: { rules?: CatalogueRules; choices?: CatalogueChoice[] }; rules?: CatalogueRules; optionGroups?: CatalogueChoice[] };
export type RuleLine = { itemId: string; quantity: number; choices?: Array<{ id?: unknown; value?: unknown; values?: unknown; quantities?: unknown }> };
export function catalogueMinimums(item: RuleItem, gallagher: boolean) {
  const rules = item.rules || item.configuration?.rules;
  return { quantity: gallagher ? Math.min(item.minimumQuantity ?? 1, 5) : item.minimumQuantity ?? 1,
    guests: gallagher && rules?.guestMinimumKind === "product" ? Math.min(item.minimumGuests ?? 1, 5) : item.minimumGuests ?? 1 };
}
/** Converts a UK wall-clock date/time to UTC; rejects nonexistent BST times rather than silently shifting them. */
export function ukServiceInstant(date: string, time: string): number {
  const target = Date.parse(`${date}T${time}:00Z`);
  if (!Number.isFinite(target)) throw new Error("Choose a valid service date and time.");
  const format = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const parts = (value: number) => { const p = Object.fromEntries(format.formatToParts(value).map(x => [x.type, x.value])); return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:00Z`; };
  let result = target;
  for (let i = 0; i < 3; i++) result += target - Date.parse(parts(result));
  if (parts(result) !== `${date}T${time}:00Z`) throw new Error("This UK service time does not exist because the clocks change. Choose another time.");
  if (parts(result - 3600000) === `${date}T${time}:00Z` || parts(result + 3600000) === `${date}T${time}:00Z`) throw new Error("This UK service time is ambiguous because the clocks change. Choose another time.");
  return result;
}
export function validateCatalogueRules(items: RuleItem[], lines: RuleLine[], context: { gallagher: boolean; guestCount: number; eventDate: string; startTime: string; now: string }): void {
  const byId = new Map(items.map(x => [x.id, x]));
  if (new Set(lines.map(x => x.itemId)).size !== lines.length) throw new Error("Each menu item can appear only once.");
  for (const line of lines) {
    const item = byId.get(line.itemId); if (!item) throw new Error("A selected menu item is no longer available. Refresh the catalogue.");
    const rules = item.rules || item.configuration?.rules;
    if (!Number.isSafeInteger(line.quantity) || line.quantity < 1) throw new Error(`${item.name}: enter a positive whole quantity.`);
    const minimum = catalogueMinimums(item, context.gallagher);
    if (line.quantity < minimum.quantity) throw new Error(`${item.name} requires at least ${minimum.quantity} ordered units.`);
    if (context.guestCount < minimum.guests) throw new Error(`${item.name} requires at least ${minimum.guests} guests.`);
    if (item.quoteRequired || rules?.indicativeFrom !== undefined) throw new Error(`${item.name} requires an agreed quote; its starting price is not a purchase price.`);
    if (rules?.noticeHours !== undefined && !Number.isFinite(Date.parse(context.now))) throw new Error("The booking clock is unavailable. Try again.");
    if (rules?.noticeHours !== undefined && ukServiceInstant(context.eventDate, context.startTime) - Date.parse(context.now) < rules.noticeHours * 3600000) throw new Error(`${item.name} requires at least ${rules.noticeHours} hours notice.`);
    if (rules?.parentItemId) {
      const parent = lines.find(x => x.itemId === rules.parentItemId);
      if (!parent || parent.quantity < line.quantity || (rules.parentQuantity === "same" && parent.quantity !== line.quantity)) throw new Error(`${item.name} requires its parent package with a compatible quantity.`);
    }
    const groups = item.optionGroups || item.configuration?.choices || [];
    const choices = line.choices || [];
    if (new Set(choices.map(x => x.id)).size !== choices.length) throw new Error("Choose each option only once.");
    for (const choice of choices) if (!groups.some(g => g.id === choice.id)) throw new Error(`${item.name}: unknown selection.`);
    for (const group of groups) {
      const choice = choices.find(x => x.id === group.id);
      if ((group.controlType || group.selectionType) === "quantities") {
        const values = choice?.quantities;
        if (values !== undefined && (!values || typeof values !== "object" || Array.isArray(values))) throw new Error(`${group.label}: enter quantities for named varieties.`);
        const entries = Object.entries((values || {}) as Record<string, unknown>);
        let total = 0;
        for (const [id, quantity] of entries) {
          if (!group.options.some(x => x.id === id) || typeof quantity !== "number" || !Number.isSafeInteger(quantity) || quantity < 0) throw new Error(`${group.label}: invalid variety quantity.`);
          if (quantity > 0 && quantity < (group.minimumQuantity ?? 1)) throw new Error(`${group.label}: each selected variety requires at least ${group.minimumQuantity ?? 1}.`);
          total += quantity;
        }
        if (total !== line.quantity) throw new Error(`${group.label}: variety quantities must add up to the ordered quantity.`);
      } else {
        const raw = choice?.values ?? choice?.value;
        const selected = Array.isArray(raw) ? raw : raw ? [raw] : [];
        if (group.required && !selected.length) throw new Error(`${group.label}: choose an option.`);
        if (selected.some(x => typeof x !== "string" || !group.options.some(o => o.label === x)) || new Set(selected).size !== selected.length) throw new Error(`${group.label}: invalid selection.`);
        if (!/multi|checkbox/.test(group.controlType || group.selectionType || "select") && selected.length > 1) throw new Error(`${group.label}: choose one option.`);
      }
    }
  }
}
export function catalogueProductionConversion(quantity: number, conversion: CatalogueRules["productionConversion"]) {
  if (!conversion) return undefined;
  const result = quantity * conversion.multiplier;
  if (!Number.isFinite(result) || result <= 0 || !Number.isFinite(conversion.multiplier) || conversion.multiplier <= 0 || !conversion.unit.trim()) throw new Error("Invalid governed production-unit conversion.");
  return { quantity: result, unit: conversion.unit, rule: "Persisted governed catalogue sales-unit conversion." };
}

/** Presentation only; quantity allocations retain their stable IDs and authoritative numeric evidence. */
export function formatCatalogueChoices(choices: readonly unknown[] | undefined): string[] {
  return (choices || []).map(raw => {
    if (!raw || typeof raw !== "object") return String(raw);
    const choice = raw as { quantities?: Record<string, unknown>; quantityLabels?: Record<string, string> };
    if (choice.quantities && typeof choice.quantities === "object" && !Array.isArray(choice.quantities)) return Object.entries(choice.quantities).filter(([,n]) => typeof n === "number" && n > 0).map(([id,n]) => `${n} × ${choice.quantityLabels?.[id] || id}`).join("; ");
    return Object.values(raw as Record<string, unknown>).join(": ");
  }).filter(Boolean);
}
