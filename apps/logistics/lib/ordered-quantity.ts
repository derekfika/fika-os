import type { PlannerLine } from "./planner-read-model";

/** "Per person"/"pax" style units are shown as pax; other ordered units are shown by their first word ("Per pot - minimum 12" -> pot). */
export function orderedUnitLabel(unit: string, quantity: number) {
  const text = unit.trim();
  if (/^per\s+(person|pax|head|guest)/i.test(text) || /^pax$/i.test(text)) return "pax";
  const word = (text.match(/^(?:per\s+)?([A-Za-z]+)/i)?.[1] || text).toLowerCase();
  if (quantity === 1) return word;
  return /(s|x|ch|sh)$/.test(word) ? (word.endsWith("s") ? word : `${word}es`) : `${word}s`;
}

/** The ordered catering quantity for display, e.g. "10 pax"; undefined when the requirement carries no ordered quantity. */
export function orderedQuantityText(line: Pick<PlannerLine, "orderedQuantity" | "orderedUnit">) {
  return line.orderedQuantity !== undefined && line.orderedUnit ? `${line.orderedQuantity} ${orderedUnitLabel(line.orderedUnit, line.orderedQuantity)}` : undefined;
}

/** "Deli Style Sandwich Lunch \u2014 10 pax"; falls back to the operational "30 piece \u00b7 name" for requirements without an ordered quantity. */
export function lineDisplayText(line: Pick<PlannerLine, "displayName" | "quantity" | "unit" | "orderedQuantity" | "orderedUnit">) {
  const ordered = orderedQuantityText(line);
  return ordered ? `${line.displayName} \u2014 ${ordered}` : `${line.quantity} ${line.unit} \u00b7 ${line.displayName}`;
}

/**
 * Totals grouped by compatible unit only (ordered catering unit when present, otherwise the line's own unit). Incompatible units are
 * never summed into a generic "N units" figure.
 */
export function lineBreakdown(lines: PlannerLine[]) {
  const totals = new Map<string, number>();
  for (const line of lines) {
    const ordered = line.orderedQuantity !== undefined && line.orderedUnit;
    const quantity = ordered ? line.orderedQuantity! : line.quantity;
    const unit = ordered ? orderedUnitLabel(line.orderedUnit!, quantity) : line.unit;
    totals.set(unit, (totals.get(unit) || 0) + quantity);
  }
  return Array.from(totals, ([unit, quantity]) => ({ unit, quantity }));
}
