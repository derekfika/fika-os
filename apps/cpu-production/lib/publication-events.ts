export type PublicationChangedEvent = {
  event: "publication_changed";
  publicationDayId: string;
  serviceDate: string;
  version: number;
  action: "published" | "amended" | "withdrawn" | "republished";
};

type Listener = (event: PublicationChangedEvent) => void;
const listeners = new Set<Listener>();

export function subscribeToPublicationChanges(listener: Listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function publishPublicationChanged(event: PublicationChangedEvent) {
  for (const listener of listeners) {
    try { listener(event); } catch { /* A disconnected client must not affect other subscribers. */ }
  }
}

export function publicationEventStream(event: PublicationChangedEvent) {
  return `event: publication_changed\ndata: ${JSON.stringify(event)}\n\n`;
}
