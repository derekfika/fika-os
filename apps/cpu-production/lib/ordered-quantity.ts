import type { ProductionLine } from "./production-types";

type OrderedLine = Pick<ProductionLine, "customerQuantity" | "customerUnit">;

function formatQuantity(quantity: number) {
  return quantity.toLocaleString("en-GB", { maximumFractionDigits: 20 });
}

/** Returns only recorded customer evidence. It never derives pax from guests or recipes. */
export function orderedQuantityLabel(line: OrderedLine) {
  const quantity = line.customerQuantity;
  const recordedUnit = line.customerUnit?.trim();
  const countUnits: Record<string, [string, string]> = {
    portion: ["portion", "portions"], piece: ["piece", "pieces"], item: ["item", "items"],
    box: ["box", "boxes"], tray: ["tray", "trays"], bottle: ["bottle", "bottles"],
    pack: ["pack", "packs"], platter: ["platter", "platters"], serving: ["serving", "servings"],
  };
  const key = recordedUnit?.toLowerCase();
  const countUnit = key && Object.values(countUnits).find(([singular, plural]) => key === singular || key === plural);
  const unit = recordedUnit && /^(?:per[\s-]+)?persons?$/i.test(recordedUnit)
    ? "pax"
    : countUnit ? countUnit[quantity === 1 ? 0 : 1] : recordedUnit;
  return typeof quantity === "number" &&
    Number.isFinite(quantity) &&
    quantity > 0 &&
    unit
    ? `${formatQuantity(quantity)} ${unit}`
    : "Needs verification";
}

/** Event guests are shown only when the booking records its guest count. */
export function eventGuestCountLabel(guestCount: number | undefined) {
  return typeof guestCount === "number" && Number.isFinite(guestCount) && guestCount > 0
    ? formatQuantity(guestCount)
    : "Needs verification";
}