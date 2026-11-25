import { z } from "zod";
import { idSchema } from "../../shared/hospitality-menu-studio-content";
import type { StudioKitchenSpec } from "../../shared/hospitality-menu-studio-kitchen";
import { publicationDigest } from "../../shared/hospitality-menu-studio-publication";
import { isStudioDishChoice, studioDishChoiceId } from "../../shared/hospitality-menu-studio-selection";
import type { CanonicalBooking } from "./hospitality-booking-service";

export const submittedChoice = z.strictObject({
  id: z.literal(studioDishChoiceId), publicationHash: publicationDigest,
  quantities: z.record(idSchema, z.int().nonnegative()),
});
export const storedChoice = submittedChoice.extend({
  quantityLabels: z.record(idSchema, z.string().min(1).max(200)),
  customerDescriptions: z.record(idSchema, z.string().max(4000)).optional(),
});

export function kitchenSpecsMatchBookedChoices(
  items: CanonicalBooking["order"]["items"],
  specForIndex: (index: number) => StudioKitchenSpec | undefined,
  evidenceCount: number,
) {
  let markedLines = 0;
  for (const [index, line] of items.entries()) {
    const markers = line.choices?.filter(isStudioDishChoice);
    if (!markers?.length) continue;
    markedLines++;
    const spec = specForIndex(index);
    const choice = storedChoice.safeParse(markers[0]);
    if (markers.length !== 1 || !spec || !choice.success) return false;
    const { publicationHash, quantities, quantityLabels } = choice.data;
    const selected = Object.values(quantities).filter(quantity => quantity > 0);
    if (selected.length !== spec.selections.length || selected.reduce((sum, n) => sum + n, 0) !== line.quantity) return false;
    if (!spec.selections.every(dish => dish.customerQuantity !== undefined && dish.customerQuantity > 0 &&
        quantities[dish.selectionId] === dish.customerQuantity && dish.subject.dishId === dish.selectionId &&
        dish.publication.contentHash === publicationHash && quantityLabels[dish.selectionId] === dish.name)) return false;
  }
  // Older private handoffs predate the customer choice marker and keep their original validation.
  return markedLines === 0 || markedLines === evidenceCount;
}
