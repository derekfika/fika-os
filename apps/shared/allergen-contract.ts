export const CANONICAL_ALLERGEN_KEYS = [
  "no_key_allergens", "peanuts", "tree_nuts", "gluten", "sesame", "molluscs", "fish", "soya",
  "celery", "shellfish", "eggs", "milk", "mustard", "lupin", "sulphites",
] as const;
export type CanonicalAllergenKey = (typeof CANONICAL_ALLERGEN_KEYS)[number];
export type OperationalAllergenState = "clear" | "contains" | "may_contain";
export type CanonicalAllergenMap = Record<string, OperationalAllergenState>;
export const CANONICAL_ALLERGEN_COLUMNS = [
  ["no_key_allergens", "No key allergens"], ["peanuts", "Peanuts"], ["tree_nuts", "Tree nuts"],
  ["gluten", "Gluten"], ["sesame", "Sesame"], ["molluscs", "Molluscs"], ["fish", "Fish"],
  ["soya", "Soya"], ["celery", "Celery"], ["shellfish", "Shellfish"], ["eggs", "Eggs"],
  ["milk", "Milk"], ["mustard", "Mustard"], ["lupin", "Lupin"], ["sulphites", "Sulphites"],
] as const satisfies ReadonlyArray<readonly [CanonicalAllergenKey, string]>;
const LEGACY_KEY_MAP: Record<string, CanonicalAllergenKey> = { noKeyAllergens: "no_key_allergens", otherNuts: "tree_nuts" };
export function toCanonicalAllergenKey(key: string): CanonicalAllergenKey | undefined {
  return (CANONICAL_ALLERGEN_KEYS as readonly string[]).includes(key) ? key as CanonicalAllergenKey : LEGACY_KEY_MAP[key];
}
export function enforceNoKeyExclusivity(input: CanonicalAllergenMap): CanonicalAllergenMap {
  const result = { ...input };
  if (result.no_key_allergens && result.no_key_allergens !== "clear") {
    for (const key of CANONICAL_ALLERGEN_KEYS) if (key !== "no_key_allergens") result[key] = "clear";
  } else if (CANONICAL_ALLERGEN_KEYS.some((key) => key !== "no_key_allergens" && result[key] && result[key] !== "clear")) {
    result.no_key_allergens = "clear";
  }
  return result;
}
export function normaliseOperationalAllergens(input: Record<string, unknown> | undefined): CanonicalAllergenMap {
  const result: CanonicalAllergenMap = {};
  for (const [rawKey, rawValue] of Object.entries(input || {})) {
    const key = toCanonicalAllergenKey(rawKey);
    if (key && (rawValue === "clear" || rawValue === "contains" || rawValue === "may_contain")) result[key] = rawValue;
  }
  return enforceNoKeyExclusivity(result);
}
export function toggleOperationalAllergen(current: CanonicalAllergenMap, key: CanonicalAllergenKey): CanonicalAllergenMap {
  const state = current[key] || "clear";
  const next = state === "clear" ? "contains" : state === "contains" ? "may_contain" : "clear";
  return enforceNoKeyExclusivity({ ...current, [key]: next });
}
export function toLegacyAllergens(input: CanonicalAllergenMap): Record<string, OperationalAllergenState> {
  const result: Record<string, OperationalAllergenState> = {};
  for (const [key, value] of Object.entries(input)) if (value) result[key === "no_key_allergens" ? "noKeyAllergens" : key === "tree_nuts" ? "otherNuts" : key] = value;
  return result;
}
export type RichAllergenEvidenceValue = "contains" | "free_from" | "may_contain" | "unknown";
export type RichAllergenEvidence = { allergen: string; value: RichAllergenEvidenceValue; [key: string]: unknown };
export function evidenceToOperationalAllergens(evidence: RichAllergenEvidence[]): { allergens: CanonicalAllergenMap; unresolved: RichAllergenEvidence[] } {
  const allergens: CanonicalAllergenMap = {}; const unresolved: RichAllergenEvidence[] = [];
  for (const item of evidence) {
    const key = toCanonicalAllergenKey(item.allergen);
    if (!key || item.value === "unknown") { unresolved.push(item); continue; }
    allergens[key] = item.value === "free_from" ? "clear" : item.value;
  }
  return { allergens: enforceNoKeyExclusivity(allergens), unresolved };
}
