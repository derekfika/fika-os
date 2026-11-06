import type { DeliveredInDishRow } from "../../lib/production-day";
import { publishedPlacementLabel } from "../../lib/menu-run-sheet-order";

export function PublishedPlacementLabels({ row }: { row: Pick<DeliveredInDishRow, "menuSlots" | "slot" | "canonicalSlotId" | "menuOrderVersion"> }) {
  if (!row.menuSlots?.length) return <small className="kitchen-slot-label">{publishedPlacementLabel(row)}</small>;
  return row.menuSlots.map(slot => (
    <small className="kitchen-slot-label" key={slot.id}>
      {publishedPlacementLabel({ slot: slot.id })}
      {slot.isCoreSalad && <span className="cpu-core-salad-label" aria-label="Core Salad">CORE</span>}
    </small>
  ));
}
