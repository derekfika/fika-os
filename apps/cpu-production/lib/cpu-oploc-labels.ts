import type { ProductionOrder } from "@fika/contracts";
import { titleCaseDish } from "./production-presentation";
import { db } from "./firebase-admin";

type CanonicalOplocRecord = {
  canonicalId?: string;
  entityType?: string;
  lifecycleStatus?: string;
  publicationStatus?: string;
  record?: Record<string, unknown>;
};

function isActiveCanonicalOploc(record: CanonicalOplocRecord) {
  return record.entityType === "OPLOC" && Boolean(record.canonicalId) && record.lifecycleStatus !== "archived" && record.publicationStatus !== "withdrawn" && String(record.record?.lifecycleState || "active") === "active";
}

async function activeOplocLabels(ids: string[]) {
  const wanted = [...new Set(ids.filter(Boolean))];
  const records: CanonicalOplocRecord[] = [];
  for (let index = 0; index < wanted.length; index += 30) {
    const chunk = wanted.slice(index, index + 30);
    if (!chunk.length) continue;
    const snapshot = await db.collection("integrationHubCanonical").where("entityType", "==", "OPLOC").where("canonicalId", "in", chunk).get();
    records.push(...snapshot.docs.map(document => document.data() as CanonicalOplocRecord));
  }
  return new Map(records.filter(isActiveCanonicalOploc).map(record => [record.canonicalId!, String(record.record?.approvedName || record.canonicalId)] as const));
}

export async function withReadableDestinations(orders: ProductionOrder[]) {
  if (!orders.length) return orders;
  const needsLookup = orders.some(order => {
    const current = order.destinationLabel?.trim();
    return Boolean(order.destinationOplocId && (!current || current === order.destinationOplocId));
  });
  const labels = needsLookup
    ? await activeOplocLabels(orders.map(order => order.destinationOplocId || ""))
    : new Map<string, string>();
  return orders.map(order => { const id = order.destinationOplocId; const label = id ? labels.get(id) : undefined; const current = order.destinationLabel?.trim(); const destinationLabel = !id || !label || (!current || current === id) ? (current && current !== id ? current : label) : current.startsWith(`${id} · `) ? `${label} · ${current.slice(id.length + 3)}` : current; return { ...order, ...(destinationLabel ? { destinationLabel } : {}), lines: order.lines.map(line => ({ ...line, itemName: titleCaseDish(line.itemName) })) }; });
}
