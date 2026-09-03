export type GovernedOploc = { id: string; label: string };

// The IDs are the stable Integration Hub OPLOC identities. Keeping this small
// governed read contract shared avoids each operational surface inventing its
// own destination vocabulary; the Hub remains the authority for lifecycle.
export const GOVERNED_OPLOCS: readonly GovernedOploc[] = [
  { id: "oploc:bb4c7eea-87f5-4e79-8ed6-b973b24ded7b", label: "Haleon" },
  { id: "oploc:b835d8ee-b187-49d1-9072-7348b04bfd2d", label: "FIKA Xchange" },
  { id: "oploc:24a93500-d75d-4fe0-8beb-672d36f9da10", label: "One Angel Court" },
  { id: "oploc:8449a63b-4df8-42f7-8b73-1d2c8669f58c", label: "Commerzbank" },
  { id: "oploc:83c79eb4-4033-408c-96d7-6c496ed6f6c9", label: "Nesta" },
  { id: "oploc:a358ef5f-297b-4816-bbf5-7fef470e81d7", label: "Bridgepoint" },
  { id: "oploc:66e621fa-6e6f-4f46-9aed-462313abbe8f", label: "MNK" },
];

export const GOVERNED_OPLOC_BY_ID = new Map(GOVERNED_OPLOCS.map(value => [value.id, value]));
export const GOVERNED_OPLOC_BY_LABEL = new Map(GOVERNED_OPLOCS.map(value => [value.label.toLocaleLowerCase(), value]));
/** Historical IDs are read-compatibility aliases only; Hub remains authoritative. */
export const HISTORICAL_OPLOC_ID_ALIASES: Record<string, GovernedOploc> = {
  "oploc:46701265-15af-48f4-a230-1d27ca21bc59": GOVERNED_OPLOCS[0],
};

export const HISTORICAL_DESTINATION_ALIASES: Record<string, GovernedOploc> = {
  haleon: GOVERNED_OPLOCS[0], haelon: GOVERNED_OPLOCS[0],
  x: GOVERNED_OPLOCS[1], "fika xchange": GOVERNED_OPLOCS[1],
  nesta: GOVERNED_OPLOCS[4], comm: GOVERNED_OPLOCS[3], commerce: GOVERNED_OPLOCS[3], commerzbank: GOVERNED_OPLOCS[3],
  angel: GOVERNED_OPLOCS[2], angeel: GOVERNED_OPLOCS[2], "one angel court": GOVERNED_OPLOCS[2],
  bp: GOVERNED_OPLOCS[5], bridgepoint: GOVERNED_OPLOCS[5], mk: GOVERNED_OPLOCS[6], mnk: GOVERNED_OPLOCS[6],
};

export function resolveGovernedOploc(destinationId?: string, destinationLabel?: string) {
  if (destinationId && GOVERNED_OPLOC_BY_ID.has(destinationId)) return GOVERNED_OPLOC_BY_ID.get(destinationId);
  if (destinationId && HISTORICAL_OPLOC_ID_ALIASES[destinationId]) return HISTORICAL_OPLOC_ID_ALIASES[destinationId];
  return HISTORICAL_DESTINATION_ALIASES[String(destinationLabel || "").trim().toLocaleLowerCase()];
}

export function canonicalOplocId(oplocId?: string) {
  if (!oplocId) return oplocId;
  return HISTORICAL_OPLOC_ID_ALIASES[oplocId]?.id || oplocId;
}

export function oplocIdsMatch(left?: string, right?: string) {
  return Boolean(left && right && canonicalOplocId(left) === canonicalOplocId(right));
}
