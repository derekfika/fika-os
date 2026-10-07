import type { MovementRequest } from "./types";
import type { GovernedOploc } from "./upstream";

/** Enrich only represented endpoints. This never changes operational history or identity. */
export function movementDisplaySnapshots(movements: MovementRequest[], prior: MovementRequest[] = [], oplocs?: GovernedOploc[]) {
  const previous = new Map(prior.map(movement => [movement.canonicalId, movement]));
  const labels = new Map(oplocs?.map(oploc => [oploc.id, oploc.label]));
  return movements.map(movement => {
    const saved = previous.get(movement.canonicalId);
    const next = { ...movement };
    for (const endpoint of ["from", "to"] as const) {
      const idKey = `${endpoint}OplocId` as const;
      const labelKey = `${endpoint}LabelSnapshot` as const;
      const id = movement[idKey];
      const label = id && (labels.get(id) || movement[labelKey] || (saved?.[idKey] === id ? saved[labelKey] : undefined));
      if (label) next[labelKey] = label;
      else delete next[labelKey];
    }
    return next;
  });
}
