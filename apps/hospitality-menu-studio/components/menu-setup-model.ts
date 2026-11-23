import { calendarDay, type Menu, type Section } from "../lib/contract";

export const sectionTemplates = [
  "Finger Food",
  "Canapés",
  "Bowl Food",
  "Hot Fork Buffet",
  "Breakfast Pots",
  "Salad & Protein",
] as const;

export type NewSectionDetails = Pick<Section, "name" | "mode">;

/** Week 1 covers the menu's first service date. Use date-only arithmetic across BST/GMT. */
export function openingWeekMonday(startDate: string): string {
  const day = calendarDay(startDate);
  if (!Number.isFinite(day)) return "";
  const daysSinceMonday = (new Date(day).getUTCDay() + 6) % 7;
  const monday = new Date(day - daysSinceMonday * 86_400_000)
    .toISOString()
    .slice(0, 10);
  return Number.isFinite(calendarDay(monday)) ? monday : "";
}

export function menuSetupIssue({
  startDate,
  endDate,
  anchorMonday,
}: Pick<Menu, "startDate" | "endDate" | "anchorMonday">): string {
  if (startDate && endDate && endDate < startDate)
    return "Choose an end date on or after the start date.";
  if (anchorMonday && new Date(calendarDay(anchorMonday)).getUTCDay() !== 1)
    return "Choose a Monday for Week 1.";
  return "";
}

export type CatalogueChoice = { id: string; name: string; category?: string };

export type CatalogueChoices =
  | { state: "unchecked" | "loading" | "unavailable" }
  | { state: "loaded"; items: CatalogueChoice[] };

function matchName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("en-GB");
}

/** Compare display names only for suggestions. An operator must confirm the stable item ID. */
export function catalogueSuggestion(
  section: Section,
  choices: CatalogueChoices,
  usedIds: ReadonlySet<string>,
) {
  const name = matchName(section.name);
  if (section.catalogueItemId || !name || choices.state !== "loaded")
    return { status: "none" } as const;
  const matches = choices.items.filter((item) => matchName(item.name) === name);
  if (matches.length > 1) return { status: "ambiguous" } as const;
  const item = matches[0];
  if (item && usedIds.has(item.id)) return { status: "already-used" } as const;
  return item
    ? ({ status: "suggested", item } as const)
    : ({ status: "none" } as const);
}

/** Category distinguishes items with the same displayed name when Hub supplies it. */
export function catalogueOptionLabel(item: CatalogueChoice): string {
  return item.category && item.category !== item.name
    ? `${item.name} · ${item.category}`
    : item.name;
}
