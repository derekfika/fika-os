import type { ProductionLine, ProductionOrder } from "@hub/lib/production-domain";
import type { OperationalAllergenState } from "../../shared/allergen-contract";
import { cpuAttentionLabel, cpuDestinationLabel, cpuLifecycle, cpuLifecycleLabels, cpuRequiredTime, cpuSourceLabel } from "./production-presentation";

export type DeliveredInDishTotal = { key: string; dishName: string; total: number; destinations: Array<{ label: string; quantity: number }> };
export type DeliveredInDishRow = { key: string; name: string; quantity: number; destinations: Array<{ label: string; quantity: number }>; snapshot?: NonNullable<ProductionLine["approvedAllergenSnapshot"]>; reviewed: boolean };
export type AllergenReviewRow = DeliveredInDishRow & { sources: string[]; attention: boolean };

export function orderDate(order: ProductionOrder) { return order.serviceDate || order.requiredBy.slice(0, 10); }
export function orderQuantity(order: ProductionOrder) { return order.lines.reduce((sum, line) => sum + (line.productionQuantity ?? line.customerQuantity), 0); }
export function orderLineCount(order: ProductionOrder) { return order.lines.length; }
export function orderSummary(order: ProductionOrder) { return `${orderQuantity(order).toLocaleString()} ${order.origin === "menu_planning" ? "portions" : "items"} · ${orderLineCount(order)} line${orderLineCount(order) === 1 ? "" : "s"}`; }
export function sourceHeading(order: ProductionOrder) { return order.origin === "menu_planning" ? "Delivered-In lunch" : cpuSourceLabel(order).replace(/ order$/, ""); }
export function requiredTime(order: ProductionOrder) { return cpuRequiredTime(order); }
export function destination(order: ProductionOrder) { return cpuDestinationLabel(order); }
export function lifecycle(order: ProductionOrder) { return cpuLifecycleLabels[cpuLifecycle(order)]; }
export function attentionCount(orders: ProductionOrder[]) { return orders.filter(order => Boolean(cpuAttentionLabel(order))).length; }

export function productionJobKey(order: ProductionOrder) {
  if (order.origin === "menu_planning") return `${order.origin}:${order.sourcePublicationDayId || order.sourceEntityId || order.canonicalId}:${orderDate(order)}`;
  return `${order.origin}:${order.sourceEntityId || order.canonicalId}`;
}
export function productionJobCount(orders: ProductionOrder[]) { return new Set(orders.map(productionJobKey)).size; }
export function firstDeliveredInOrder(orders: ProductionOrder[]) { return orders.find(order => order.origin === "menu_planning"); }
export function relatedDeliveredInOrders(orders: ProductionOrder[], selected: ProductionOrder) {
  const key = productionJobKey(selected);
  return orders.filter(order => order.origin === "menu_planning" && productionJobKey(order) === key);
}
export function deliveredInTotals(orders: ProductionOrder[]) {
  const related = orders.filter(order => order.origin === "menu_planning");
  return { portions: related.reduce((sum, order) => sum + orderQuantity(order), 0), dishes: aggregateDeliveredIn(related).length, destinations: new Set(related.map(destination)).size };
}

function mergeAllergenState(current: OperationalAllergenState | undefined, next: string | undefined): OperationalAllergenState { if (current === "contains" || next === "contains") return "contains"; if (current === "may_contain" || next === "may_contain") return "may_contain"; return "clear"; }
export function buildDeliveredInDishRows(orders: ProductionOrder[]): DeliveredInDishRow[] {
  const rows = new Map<string, DeliveredInDishRow & { destinationMap: Map<string, number>; allergens: Record<string, OperationalAllergenState> }>();
  for (const order of orders) for (const line of order.lines) {
    const key = line.sourceMenuItemId || line.itemName.trim().toLowerCase();
    const current = rows.get(key) || ({ key, name: line.itemName, quantity: 0, destinations: [], destinationMap: new Map<string, number>(), allergens: {} as Record<string, OperationalAllergenState>, snapshot: undefined, reviewed: true } as DeliveredInDishRow & { destinationMap: Map<string, number>; allergens: Record<string, OperationalAllergenState> });
    const quantity = line.productionQuantity ?? line.customerQuantity; const label = destination(order);
    current.quantity += quantity; current.destinationMap.set(label, (current.destinationMap.get(label) || 0) + quantity); current.reviewed = current.reviewed && line.allergenEvidenceStatus === "confirmed";
    if (line.approvedAllergenSnapshot) { current.snapshot ||= line.approvedAllergenSnapshot; for (const [keyName, state] of Object.entries(line.approvedAllergenSnapshot.allergens)) current.allergens[keyName] = mergeAllergenState(current.allergens[keyName], state); }
    rows.set(key, current);
  }
  return [...rows.values()].map(row => ({ ...row, destinations: [...row.destinationMap.entries()].map(([label, quantity]) => ({ label, quantity })).sort((a, b) => a.label.localeCompare(b.label)), snapshot: row.snapshot ? { ...row.snapshot, allergens: row.allergens } : undefined })).sort((a, b) => a.name.localeCompare(b.name));
}
export function buildAllergenReviewRows(orders: ProductionOrder[]): AllergenReviewRow[] {
  const grouped = new Map<string, AllergenReviewRow & { destinationMap: Map<string, number>; allergens: Record<string, OperationalAllergenState> }>();
  for (const order of orders) for (const line of order.lines) {
    const key = `${order.origin}:${line.sourceMenuItemId || line.itemName.trim().toLowerCase()}`;
    const current = grouped.get(key) || ({ key, name: line.itemName, quantity: 0, destinations: [], sources: [], attention: false, destinationMap: new Map<string, number>(), allergens: {}, reviewed: true } as AllergenReviewRow & { destinationMap: Map<string, number>; allergens: Record<string, OperationalAllergenState> });
    const quantity = line.productionQuantity ?? line.customerQuantity;
    const label = destination(order);
    current.quantity += quantity;
    current.destinationMap.set(label, (current.destinationMap.get(label) || 0) + quantity);
    current.sources = [...new Set([...current.sources, cpuSourceLabel(order)])];
    current.attention ||= !line.approvedAllergenSnapshot || line.allergenEvidenceStatus === "missing" || line.allergenEvidenceStatus === "conflicting";
    current.reviewed = current.reviewed && line.allergenEvidenceStatus === "confirmed";
    if (line.approvedAllergenSnapshot) {
      current.snapshot ||= line.approvedAllergenSnapshot;
      for (const [keyName, state] of Object.entries(line.approvedAllergenSnapshot.allergens)) current.allergens[keyName] = mergeAllergenState(current.allergens[keyName], state);
    }
    grouped.set(key, current);
  }
  return [...grouped.values()].map(row => ({ ...row, destinations: [...row.destinationMap.entries()].map(([label, quantity]) => ({ label, quantity })).sort((a, b) => a.label.localeCompare(b.label)), snapshot: row.snapshot ? { ...row.snapshot, allergens: row.allergens } : undefined })).sort((a, b) => a.name.localeCompare(b.name));
}
export function categorySummary(orders: ProductionOrder[]) {
  const jobs = productionJobCount(orders);
  const parts = [`${jobs} production job${jobs === 1 ? "" : "s"}`];
  const portions = orders.filter(order => order.origin === "menu_planning").reduce((sum, order) => sum + orderQuantity(order), 0);
  const items = orders.filter(order => order.origin === "grab_and_go").reduce((sum, order) => sum + orderQuantity(order), 0);
  const pax = orders.filter(order => order.origin === "hospitality_booking").reduce((sum, order) => sum + (order.guestCount ?? orderQuantity(order)), 0);
  if (portions) parts.push(`${portions.toLocaleString()} lunch portion${portions === 1 ? "" : "s"}`);
  if (items) parts.push(`${items.toLocaleString()} Grab & Go item${items === 1 ? "" : "s"}`);
  if (pax) parts.push(`${pax.toLocaleString()} hospitality pax`);
  return parts.join(" · ");
}

export function aggregateDeliveredIn(orders: ProductionOrder[]): DeliveredInDishTotal[] {
  const totals = new Map<string, { dishName: string; total: number; destinations: Map<string, number> }>();
  for (const order of orders.filter(item => item.origin === "menu_planning")) {
    const label = destination(order);
    for (const line of order.lines) {
      const key = line.sourceMenuItemId || line.itemName.trim().toLowerCase();
      const existing = totals.get(key) || { dishName: line.itemName, total: 0, destinations: new Map<string, number>() };
      const quantity = line.productionQuantity ?? line.customerQuantity;
      existing.total += quantity;
      existing.destinations.set(label, (existing.destinations.get(label) || 0) + quantity);
      totals.set(key, existing);
    }
  }
  return [...totals.entries()].map(([key, value]) => ({ key, dishName: value.dishName, total: value.total, destinations: [...value.destinations.entries()].map(([label, quantity]) => ({ label, quantity })).sort((a, b) => a.label.localeCompare(b.label)) })).sort((a, b) => a.dishName.localeCompare(b.dishName));
}

export function groupByRequiredTime(orders: ProductionOrder[]) {
  const groups = new Map<string, ProductionOrder[]>();
  for (const order of orders) { const key = requiredTime(order); groups.set(key, [...(groups.get(key) || []), order]); }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([time, grouped]) => ({ time, orders: grouped.sort((a, b) => destination(a).localeCompare(destination(b))) }));
}
