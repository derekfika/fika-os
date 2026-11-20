"use client";

import type { OperationalAllergenState } from "../../../shared/allergen-contract";
import type { RowAllergenContext } from "../lib/allergen-explicit";
import { binaryCellAriaLabel, binaryCellPressed, binaryCellView } from "./allergen-cell-state";

/** One existing CPU allergen box, shared by all Hospitality review subjects. */
export function HospitalityAllergenCell({
  allergenKey, label, rowName, allergens, context, locked, onToggle,
}: {
  allergenKey: string;
  label: string;
  rowName: string;
  allergens: Record<string, OperationalAllergenState> | undefined;
  context: RowAllergenContext;
  locked: boolean;
  onToggle: () => void;
}) {
  const view = binaryCellView(allergens, allergenKey, context);
  return (
    <button
      type="button"
      aria-label={binaryCellAriaLabel(label, rowName, view)}
      aria-pressed={binaryCellPressed(view)}
      aria-disabled={locked || undefined}
      data-allergen-key={allergenKey}
      data-cell-state={view}
      className={`allergen-cell allergen-cell--${view === "on" ? "contains" : view === "may_contain" ? "may_contain" : "off"}`}
      onClick={onToggle}
    />
  );
}
