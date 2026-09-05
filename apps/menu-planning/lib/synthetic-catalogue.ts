import type { MenuItem } from "./domain";

export type SyntheticCatalogueCandidate = { id: string; displayName: string; reasons: string[] };

/** Candidate detection requires provenance evidence as well as a suspicious label. */
export function syntheticCatalogueCandidate(item: MenuItem): SyntheticCatalogueCandidate | undefined {
  const audit = item.audit || [];
  const provenance = [item.canonicalId, item.sourceReference?.workbook, item.sourceReference?.sheet, ...audit.flatMap(entry => [entry.action, entry.by]), ...(item.allergenEvidence || []).flatMap(entry => [entry.source, entry.reviewedBy || ""])].join(" ").toLocaleLowerCase();
  const name = item.displayName.trim();
  const reasons: string[] = [];
  if (/(?:^|[-_: ])(?:test|fixture|synthetic|e2e)(?:$|[-_: ])/i.test(provenance)) reasons.push("test/fixture provenance");
  if (/(?:matrix dish|monday dish|menu-item:\s*rolling|durable test dish)/i.test(name) && /(?:rolling-menu-item-promoted|test|fixture|synthetic)/i.test(provenance)) reasons.push("known synthetic naming with non-operational provenance");
  if (!reasons.length) return undefined;
  return { id: item.canonicalId, displayName: name, reasons: [...new Set(reasons)] };
}
