/** Normalise dish/menu names for consistent display and storage. */
const dishSpellingCorrections: Array<[RegExp, string]> = [
  [/\bavacado\b/gi, "avocado"],
  [/\bavocordo\b/gi, "avocado"],
  [/\bcorriander\b/gi, "coriander"],
  [/\bcoriandar\b/gi, "coriander"],
  [/\bmayonaisse\b/gi, "mayonnaise"],
  [/\bmayonaise\b/gi, "mayonnaise"],
  [/\bmozzarela\b/gi, "mozzarella"],
  [/\bmozarella\b/gi, "mozzarella"],
  [/\bpomegrante\b/gi, "pomegranate"],
  [/\btumeric\b/gi, "turmeric"],
];

export function normaliseDishName(value: string): string {
  let cleaned = value.trim().replace(/\s+/g, " ");
  cleaned = cleaned.replace(/\s+([,;:])/g, "$1").replace(/([,;:])(?=\S)/g, "$1 ");
  cleaned = cleaned.replace(/\s*&\s*/g, " & ");
  for (const [pattern, replacement] of dishSpellingCorrections) cleaned = cleaned.replace(pattern, replacement);
  return titleCase(cleaned);
}

export function titleCase(value: string): string {
  return value.trim().toLocaleLowerCase("en-GB").replace(/(^|[^A-Za-zÀ-ÿ])([a-zà-ÿ])/g, (_, prefix: string, letter: string) => `${prefix}${letter.toLocaleUpperCase("en-GB")}`);
}
