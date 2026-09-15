export type PortionDraftEntry = { id: string; allocations: Array<{ destinationId?: string; destinationLabel: string; quantity: number }> };
export type PortionDraftDestination = { id: string; label: string; oneOff?: boolean };

const numberOrZero = (value: unknown) => { const number = Number(value); return Number.isFinite(number) && number >= 0 ? number : 0; };
export function persistedPortionValue(entry: PortionDraftEntry, destination: PortionDraftDestination) {
  const allocation = entry.allocations.find(item => destination.oneOff ? item.destinationLabel === destination.label && !item.destinationId : item.destinationId === destination.id || (!item.destinationId && item.destinationLabel.trim().toLocaleLowerCase() === destination.label.trim().toLocaleLowerCase()));
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
