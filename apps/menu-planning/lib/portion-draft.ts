export type PortionDraftEntry = { id: string; allocations: Array<{ destinationId?: string; oneOffDestinationId?: string; destination?: { kind: "governed" | "one-off"; id: string }; destinationLabel: string; destinationAddress?: string; quantity: number }> };
export type PortionDraftDestination = { id: string; label: string; address?: string; oneOff?: boolean };

export function allocationMatchesPortionDestination(allocation: PortionDraftEntry["allocations"][number], destination: PortionDraftDestination) {
  const oneOffId = allocation.oneOffDestinationId || (allocation.destination?.kind === "one-off" ? allocation.destination.id : undefined);
  if (oneOffId) return Boolean(destination.oneOff) && destination.id.replace(/^oneoff:/, "") === oneOffId;
  if (allocation.destinationId) return !destination.oneOff && allocation.destinationId === destination.id;
  // Historical name matching remains a display compatibility path only for
  // allocations without identity. Explicit one-offs never match an OPLOC name.
  if (destination.oneOff) return allocation.destinationLabel === destination.label && (!destination.address || !allocation.destinationAddress || destination.address === allocation.destinationAddress);
  return allocation.destinationLabel.trim().toLocaleLowerCase() === destination.label.trim().toLocaleLowerCase();
}

const numberOrZero = (value: unknown) => { const number = Number(value); return Number.isFinite(number) && number >= 0 ? number : 0; };
export function persistedPortionValue(entry: PortionDraftEntry, destination: PortionDraftDestination) {
  const allocation = entry.allocations.find(item => allocationMatchesPortionDestination(item, destination));
  return numberOrZero(allocation?.quantity);
}
export function draftValueMatchesPersisted(raw: unknown, entry: PortionDraftEntry, destination: PortionDraftDestination) {
  const text = String(raw ?? "").trim();
  if (text !== "" && (!Number.isFinite(Number(text)) || Number(text) < 0)) return false;
  return numberOrZero(text) === persistedPortionValue(entry, destination);
}
export function reconcilePortionDraft(draft: Record<string, string>, entries: PortionDraftEntry[], destinations: PortionDraftDestination[]) {
  const entriesById = new Map(entries.map(entry => [entry.id, entry]));
  const destinationsById = new Map(destinations.map(destination => [destination.id, destination]));
  return Object.fromEntries(Object.entries(draft).filter(([key, value]) => {
    const separator = key.indexOf("|");
    if (separator < 1) return false;
    const entry = entriesById.get(key.slice(0, separator));
    const destination = destinationsById.get(key.slice(separator + 1));
    return Boolean(entry && destination && !draftValueMatchesPersisted(value, entry, destination));
  }));
}
