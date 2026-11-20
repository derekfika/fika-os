import { readStudioKitchenSpec, type StudioKitchenAssortment } from "../../shared/hospitality-menu-studio-kitchen";
import type { ProductionLine, ProductionOrder } from "./production-types";

export const studioKitchenSpecError = "The frozen kitchen specification could not be verified.";

/** Undefined is a legacy line. Null means evidence was supplied but failed validation. */
export function studioKitchenSpecForLine(
  order: Pick<ProductionOrder, "origin" | "sourceBookingId">,
  line: Pick<ProductionLine, "sourceBookingLineId" | "studioKitchenSpec">,
) {
  if (line.studioKitchenSpec === undefined) return undefined;
  if (order.origin !== "hospitality_booking") return null;
  return readStudioKitchenSpec(line.studioKitchenSpec, order.sourceBookingId, line.sourceBookingLineId) ?? null;
}

export function orderHasInvalidStudioKitchenSpec(order: ProductionOrder) {
  return order.lines.some(line => studioKitchenSpecForLine(order, line) === null);
}

export function studioAssortmentQuantities(assortment: StudioKitchenAssortment) {
  const { boxCount, expectedTotal, unit } = assortment;
  const summary = `${boxCount} ${boxCount === 1 ? "box" : "boxes"} · ${expectedTotal} ${unit} per box · ${boxCount * expectedTotal} ${unit} total`;
  const components = assortment.components.map(({ id, name, quantity }) => ({
    id,
    label: `${name} · ${quantity} ${unit} per box · ${boxCount * quantity} ${unit} total`,
  }));
  return { summary, components };
}
