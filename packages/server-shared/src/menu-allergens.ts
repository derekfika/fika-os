import { MenuArtifactError, type NormalizedMenuItem } from "./menu-types";

/**
 * Allergen semantics for every menu output.
 *
 *   contains      -> "Contains: ..."
 *   mayContain    -> "May contain: ..."          (never merged into `contains`)
 *   unrecorded    -> the dish is refused         (never rendered as clear)
 *   noKeyAllergens-> "No key allergens"          (only when positively established)
 *   none of those -> the dish is refused         (unknown is not clear)
 */

const ALLERGEN_LABEL_OVERRIDES: Record<string, string> = { no_key_allergens: "No key allergens" };

/** `tree_nuts` -> `Tree Nuts`. Raw machine keys never reach a customer-facing menu. */
export function menuAllergenLabel(key: string) {
  const override = ALLERGEN_LABEL_OVERRIDES[key];
  if (override) return override;
  return key.replace(/[_-]+/g, " ").trim().replace(/[A-Za-zÀ-ÿ]+/g, word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());
}

export type MenuAllergenLineKind = "contains" | "may-contain" | "clear";
export type MenuAllergenLine = { kind: MenuAllergenLineKind; label: string; text: string };

const declared = (keys: string[]) => [...new Set(keys)].filter(key => key !== "no_key_allergens");

/**
 * The declared allergen lines for one dish, in display order. A key that is
 * contained is not repeated under "May contain". Throws for any dish whose
 * allergen state is not safe to print.
 */
export function menuAllergenLines(item: NormalizedMenuItem): MenuAllergenLine[] {
  assertAllergensPrintable(item);
  const contains = declared(item.contains);
  const may = declared(item.mayContain).filter(key => !contains.includes(key));
  const lines: MenuAllergenLine[] = [];
  if (contains.length) lines.push({ kind: "contains", label: "Contains:", text: `Contains: ${contains.map(menuAllergenLabel).join(", ")}` });
  if (may.length) lines.push({ kind: "may-contain", label: "May contain:", text: `May contain: ${may.map(menuAllergenLabel).join(", ")}` });
  if (!lines.length) lines.push({ kind: "clear", label: "No key allergens", text: "No key allergens" });
  return lines;
}

export function assertAllergensPrintable(item: NormalizedMenuItem) {
  const name = item.name.trim() || item.id;
  if (item.unrecorded?.length) throw new MenuArtifactError("MENU_ALLERGENS_UNRECORDED", `"${name}" has unrecorded allergens (${item.unrecorded.join(", ")}); a menu cannot be printed until they are recorded.`, 409);
  if (!declared(item.contains).length && !declared(item.mayContain).length && !item.noKeyAllergens) {
    throw new MenuArtifactError("MENU_ALLERGENS_NOT_ESTABLISHED", `Allergens for "${name}" are not established; it is not printed as having no allergens. Record its allergens first.`, 409);
  }
}

/** Single-line form kept for callers that need one string: `(Gluten, Milk)`; may-contain is labelled, never merged. */
export function menuAllergenLine(item: NormalizedMenuItem) {
  const lines = menuAllergenLines(item).filter(line => line.kind !== "clear");
  return lines.length ? `(${lines.map(line => line.text).join("; ")})` : "";
}

const KNOWN_NEGATIVE_STATES = new Set(["clear", "none", "absent", "does_not_contain"]);

/**
 * Allergen states from either workflow -> normalized sets. `unrecorded` is never
 * treated as clear. `noKeyAllergens` is true only when it is positively established:
 * every recorded state is a known one (or the workflow's explicit `no_key_allergens`
 * marker is set), nothing is unrecorded and nothing is contained or may be contained.
 */
export function allergensFromStates(states: Record<string, string | undefined> | undefined) {
  const contains: string[] = []; const mayContain: string[] = []; const unrecorded: string[] = [];
  let entries = 0; let unknown = 0;
  for (const [key, state] of Object.entries(states || {})) {
    if (key === "no_key_allergens") continue;
    entries += 1;
    if (state === "contains") contains.push(key);
    else if (state === "may_contain") mayContain.push(key);
    else if (state === "unrecorded") unrecorded.push(key);
    else if (!state || !KNOWN_NEGATIVE_STATES.has(state)) unknown += 1;
  }
  const flagged = states?.no_key_allergens === "contains"; // the workflows' positive "no key allergens" marker
  const noKeyAllergens = (entries > 0 || flagged) && !unknown && !unrecorded.length && !contains.length && !mayContain.length;
  return { contains, mayContain, unrecorded, noKeyAllergens };
}
