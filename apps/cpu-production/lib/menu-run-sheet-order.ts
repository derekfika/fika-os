import { CANONICAL_MENU_SLOTS, canonicalMenuSlotIdFor, menuSectionForSlot, orderMenuEntries } from "../../shared/menu-section-order";
import type { ProductionLine, ProductionOrder } from "./production-types";

export type RunSheetMenuLine = { line: ProductionLine; slotLabel: string };
export type RunSheetMenuSection = { id: string; label: string; lines: RunSheetMenuLine[] };

type PublishedPlacement = Pick<ProductionLine, "slot" | "canonicalSlotId" | "menuOrderVersion">;

export function menuPlacementKey(line: PublishedPlacement) {
  return canonicalMenuSlotIdFor(line.canonicalSlotId || "") || canonicalMenuSlotIdFor(line.slot || "") || line.slot?.trim() || "";
}

function canonicalSlotFor(line: PublishedPlacement) {
  const id = menuPlacementKey(line);
  return CANONICAL_MENU_SLOTS.find(slot => slot.id === id);
}

function displaySlotLabel(line: PublishedPlacement, duplicateLabels?: ReadonlySet<string>) {
  const slot = canonicalSlotFor(line);
  if (slot) {
    if (duplicateLabels?.has(`${slot.sectionId}:${slot.label}`) ?? CANONICAL_MENU_SLOTS.some(other => other.id !== slot.id && other.sectionId === slot.sectionId && other.label === slot.label)) {
      const index = slot.id.match(/(\d+)$/)?.[1];
      return index ? `${slot.label} ${index}` : slot.label;
    }
    return slot.label;
  }
  return line.slot?.trim() || (line.menuOrderVersion ? "Published placement missing" : "Category not recorded");
}

export function publishedPlacementLabel(line: PublishedPlacement) {
  const section = menuSectionForSlot(menuPlacementKey(line));
  return [section.id === "other" ? "" : section.label, displaySlotLabel(line)].filter(Boolean).join(" · ");
}

/** Groups only Menu Planning orders by the published canonical contract. Other sources retain authored line order. */
export function runSheetMenuSections(order: ProductionOrder): RunSheetMenuSection[] {
  if (order.origin !== "menu_planning") return [{ id: "production-items", label: "PRODUCTION ITEMS", lines: order.lines.map(line => ({ line, slotLabel: "" })) }];

  const duplicateLabels = new Set<string>();
  const labelCounts = new Map<string, number>();
  for (const line of order.lines) {
    const slot = canonicalSlotFor(line);
    if (!slot) continue;
    const key = `${slot.sectionId}:${slot.label}`;
    labelCounts.set(key, (labelCounts.get(key) || 0) + 1);
  }
  for (const [key, count] of labelCounts) if (count > 1) duplicateLabels.add(key);

  const lines = orderMenuEntries(order.lines.map((line, index) => ({
    line,
    slot: menuPlacementKey(line),
    originalIndex: line.canonicalOrderIndex ?? line.sortOrder ?? index,
    sourceEntryId: line.sourceBookingLineId || line.canonicalId,
  })));
  const sections = new Map<string, RunSheetMenuSection>();
  for (const ordered of lines) {
    const descriptor = menuSectionForSlot(ordered.slot);
    const label = descriptor.id === "other" ? "OTHER PLACEMENTS" : descriptor.label;
    const section = sections.get(descriptor.id) || { id: descriptor.id, label, lines: [] };
    section.lines.push({ line: ordered.line, slotLabel: displaySlotLabel(ordered.line, duplicateLabels) });
    sections.set(descriptor.id, section);
  }
  return [...sections.values()];
}
