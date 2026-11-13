"use client";
import { HotForkBuffetChoiceSchema, HOT_FORK_BUFFET_CHOICE_ID, HOT_FORK_BUFFET_SELECTION_CONTRACT, buffetPackageForItem as governedBuffetPackage, validateHotForkBuffetDraft } from "@fika/server-shared/hospitality-buffet-selection";
import { BuffetMenuPicker } from "./BuffetMenuPicker";
import { buffetChoice, type BuffetConfig, type BuffetPreview } from "../../lib/buffet-menu-client";
import type { CanonicalBooking } from "../../lib/canonical-types";
import type { PortalMenuItem } from "../../lib/mnk-contract";

type Line = CanonicalBooking["order"]["items"][number];
export function hasBuffetLine(lines: readonly Line[]) { return lines.some(line => Boolean(governedBuffetPackage(line.itemId))); }
export function storedBuffetPreview(line: Line): BuffetPreview | undefined {
  const choices = (line.choices || []).filter(choice => choice && typeof choice === "object" && (choice as { id?: unknown }).id === HOT_FORK_BUFFET_CHOICE_ID);
  if (choices.length !== 1) return undefined;
  const parsed = HotForkBuffetChoiceSchema.safeParse(choices[0]);
  if (!parsed.success) return undefined;
  const value = parsed.data.value;
  return { menuVersion: value.menuVersion, ...(value.contract === HOT_FORK_BUFFET_SELECTION_CONTRACT ? { rulesVersion: value.rulesVersion } : {}), selection: { packageId: value.packageId, nonVegetarianMainId: value.mains[0].dishId, vegetarianMainId: value.mains[1].dishId, mainPortions: Object.fromEntries(value.mains.map(main => [main.dishId, main.portions])), saladIds: value.saladIds, dessertIds: value.contract === HOT_FORK_BUFFET_SELECTION_CONTRACT ? value.dessertIds : value.desserts.map(dessert => dessert.dishId) } };
}
/** Reject changed guest counts or malformed choices before the authoritative Hub amendment. */
export function buffetAmendmentIssue(lines: readonly Line[], guestCount: number, original: CanonicalBooking): string | undefined {
  for (const line of lines) {
    if (!governedBuffetPackage(line.itemId) || line.quantity <= 0) continue;
    const selected = (line.choices || []).filter(choice => choice && typeof choice === "object" && (choice as { id?: unknown }).id === HOT_FORK_BUFFET_CHOICE_ID);
    const originalLine = original.order.items.find(item => item.itemId === line.itemId);
    if (!selected.length) {
      if (originalLine?.choices?.some(choice => choice && typeof choice === "object" && (choice as { id?: unknown }).id === HOT_FORK_BUFFET_CHOICE_ID)) return "The saved buffet selection needs review; it cannot be silently removed.";
      continue; // Legacy menu-on-request remains available.
    }
    const unchanged = originalLine && originalLine.quantity === line.quantity && original.service.guestCount === guestCount && JSON.stringify(originalLine.choices || []) === JSON.stringify(line.choices || []);
    if (unchanged) continue;
    if (selected.length !== 1 || line.quantity !== guestCount) return "Review the buffet menu and set its quantity to the guest count.";
    try { validateHotForkBuffetDraft((selected[0] as { value: unknown }).value, line.itemId, guestCount); }
    catch (cause) { return cause instanceof Error ? cause.message : "Review the buffet menu for the current guest count."; }
  }
  return undefined;
}

export function BuffetAmendmentSelector({ config, line, catalogue, selectedItemIds, guestCount, dietaryNotes, onSave }: { config?: BuffetConfig; line: Line; catalogue: readonly PortalMenuItem[]; selectedItemIds: readonly string[]; guestCount: number; dietaryNotes: string; onSave(line: Line, notes: string): void }) {
  const item = catalogue.find(candidate => [candidate.id, candidate.canonicalId].includes(line.menuItemId || line.itemId));
  if (!governedBuffetPackage(line.itemId) || line.quantity <= 0) return null;
  if (!config || !item) return <p role="status">The buffet selector is unavailable. Existing choices are retained; refresh to edit the menu.</p>;
  const hasSelection = (line.choices || []).some(choice => choice && typeof choice === "object" && (choice as { id?: unknown }).id === HOT_FORK_BUFFET_CHOICE_ID);
  return <>{hasSelection && !storedBuffetPreview(line) && <p role="alert">The saved buffet selection needs review. Choose the menu again before changing it.</p>}<BuffetMenuPicker config={config} item={item} catalogue={catalogue} selectedItemIds={selectedItemIds} guestCount={guestCount} preview={storedBuffetPreview(line)} dietaryNotes={dietaryNotes} onSave={(target, preview, notes) => onSave({ ...line, itemId: target.canonicalId || target.id, menuItemId: target.canonicalId || target.id, itemName: target.name, category: target.category, description: target.description, servingInfo: target.servingInfo, unitPrice: target.unitPrice, quantity: guestCount, lineTotal: target.unitPrice * guestCount, choices: [...(line.choices || []).filter(choice => !choice || typeof choice !== "object" || (choice as { id?: unknown }).id !== HOT_FORK_BUFFET_CHOICE_ID), buffetChoice(preview)] }, notes)} /></>;
}

const dietaryFields = [["vegetarian", "Vegetarian"], ["vegan", "Vegan"], ["glutenFree", "Gluten free"], ["coeliac", "Coeliac"], ["dairyFree", "Dairy free"], ["halal", "Halal"], ["otherCount", "Other dietary meals"], ["allergyDetails", "Allergy details"]] as const;
export function isBuffetDietaryField(key: string) { return dietaryFields.some(([name]) => name === key); }
/** Expose missing fields without inventing zero values in older saved bookings. */
export function BuffetDietaryFields({ dietaries, onChange }: { dietaries: Record<string, unknown>; onChange(value: Record<string, unknown>): void }) {
  return <>{dietaryFields.map(([key, label]) => <label key={key}>{label}<input type={key === "allergyDetails" ? "text" : "number"} min={key === "allergyDetails" ? undefined : 0} value={typeof dietaries[key] === "string" || typeof dietaries[key] === "number" ? String(dietaries[key]) : ""} onChange={event => { const raw = event.target.value; const next = { ...dietaries }; if (raw === "") delete next[key]; else { next[key] = key === "allergyDetails" ? raw : Number(raw); if (raw.trim() && (key === "allergyDetails" || Number(raw) > 0)) next.hasDietaries = true; } onChange(next); }} /></label>)}</>;
}
