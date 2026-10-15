/**
 * Shared quantity-entry rules for every Hospitality booking portal (RCoA, All Day item picker, MNK, Angel Court, CFC, Munich Re).
 * Typing is free: the product minimum is NEVER applied while the customer is mid-keystroke (min 8: "1" -> "10" -> "100" must stay as
 * typed). The minimum is reported once editing is done (blur / Enter) and by the existing step validation, which blocks continuing.
 * Only the +/- buttons act on the minimum directly.
 */

/** Raw field text to a whole quantity. Empty or non-numeric text is 0 (the line is removed), never the product minimum. */
export function quantityFromInput(raw: string | number | null | undefined): number {
  const value = typeof raw === "number" ? raw : Number(String(raw ?? "").trim() || 0);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

/** "Minimum order is 8" when a quantity has been entered but is below the minimum; otherwise empty. */
export function quantityMinimumMessage(quantity: number, minimum: number): string {
  return quantity > 0 && quantity < minimum ? `Minimum order is ${minimum}` : "";
}

/** Plus: from nothing (or below the minimum) go straight to the minimum, otherwise add one. */
export function stepQuantityUp(current: number, minimum: number): number {
  return current < minimum ? minimum : current + 1;
}

/** Minus never leaves a selected item below its minimum: above the minimum subtract one; at/below it, remove the item (or hold at the minimum). */
export function stepQuantityDown(current: number, minimum: number, removeAtMinimum: boolean): number {
  if (current <= 0) return 0;
  if (current > minimum) return current - 1;
  return removeAtMinimum ? 0 : minimum;
}
