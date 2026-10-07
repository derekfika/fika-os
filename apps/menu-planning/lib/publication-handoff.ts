import type { MenuPublicationCommandResult } from "./menu-publication";
import { getMenuPlanningEvent, listMenuPlanningEventIdsForPublication } from "./operational-store";

export type PublicationHandoff = {
  status: "pending" | "delivered" | "intervention-required";
  delivered: number;
  pending: number;
  deadLettered: number;
};

/** The transaction has durably queued these IDs; no network delivery runs here. */
export function queuedPublicationHandoff(publication: MenuPublicationCommandResult): PublicationHandoff {
  const pending = new Set(publication.handoffEventIds || []).size;
  return { status: "pending", delivered: 0, pending, deadLettered: 0 };
}

/** Publication-scoped IDs followed by direct document reads, never a global scan. */
export async function getPublicationHandoff(publicationId: string): Promise<PublicationHandoff> {
  const ids = await listMenuPlanningEventIdsForPublication(publicationId);
  const events = await Promise.all(ids.map(getMenuPlanningEvent));
  const delivered = events.filter(event => event?.delivery.status === "delivered").length;
  const deadLettered = events.filter(event => event?.delivery.status === "dead-letter").length;
  const pending = events.length - delivered - deadLettered;
  // Historical publications without an obligation must not look delivered.
  return { status: deadLettered ? "intervention-required" : pending || !ids.length ? "pending" : "delivered", delivered, pending, deadLettered };
}
