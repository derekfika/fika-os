import { db } from "./firebase-admin";
import type { ProductionOrder } from "@fika/contracts";
import { titleCaseDish } from "./production-presentation";

export async function withReadableDestinations(orders: ProductionOrder[]) {
  if (!orders.length) return orders;
  const snapshot = await db.collection("integrationHubCanonical").get();
  const labels = new Map(snapshot.docs.map(document => document.data() as { entityType?: string; canonicalId?: string; record?: { approvedName?: string; lifecycleState?: string } }).filter(record => record.entityType === "OPLOC" && record.canonicalId && record.record?.approvedName && record.record.lifecycleState !== "decommissioned").map(record => [record.canonicalId!, String(record.record!.approvedName)] as const));
  return orders.map(order => { const id = order.destinationOplocId; const label = id ? labels.get(id) : undefined; const current = order.destinationLabel?.trim(); const destinationLabel = !id || !label || (!current || current === id) ? (current && current !== id ? current : label) : current.startsWith(`${id} · `) ? `${label} · ${current.slice(id.length + 3)}` : current; return { ...order, ...(destinationLabel ? { destinationLabel } : {}), lines: order.lines.map(line => ({ ...line, itemName: titleCaseDish(line.itemName) })) }; });
}
