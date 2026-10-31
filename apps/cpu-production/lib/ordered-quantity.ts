import type { ProductionLine } from "./production-types";

type OrderedLine = Pick<ProductionLine, "customerQuantity" | "customerUnit">;

function formatQuantity(quantity: number) {
  return quantity.toLocaleString("en-GB");
}

/** Returns only recorded customer evidence. It never derives pax from guests or recipes. */
export function orderedQuantityLabel(line: OrderedLine) {
  const quantity = line.customerQuantity;
  const unit = line.customerUnit?.trim();
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

export function productionPrepLabel(
  line: Pick<ProductionLine, "productionQuantity" | "productionUnit">,
) {
  const quantity = line.productionQuantity;
  const unit = line.productionUnit?.trim();
  return typeof quantity === "number" &&
    Number.isFinite(quantity) &&
    quantity > 0 &&
    unit
    ? `${formatQuantity(quantity)} ${unit}`
    : undefined;
}
