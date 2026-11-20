import type { MenuActor } from "./auth";
import { actorCanManageOrganisation, actorCanWriteOneOff, actorCanWriteOploc } from "./auth";
import type { RollingAllocation, RollingSnapshot } from "./rolling-menu-types";
import type { PublishedMenuDay, PublishedWeekDemandChangeSet } from "./menu-publication";
import { menuSiteIdentity } from "./site-pax";

type Action = "manage" | "publish";
const denied = () => Object.assign(new Error("This change includes a destination outside your Menu Planning authority."), { status: 403 });

export function assertMenuDestinationScope(actor: MenuActor, action: Action, destinationId: string | undefined, aliases: ReadonlyMap<string, string>) {
  if (destinationId ? !actorCanWriteOploc(actor, aliases.get(destinationId) || destinationId, action) : !actorCanWriteOneOff(actor, action)) throw denied();
}

export function assertMenuAllocationsScope(actor: MenuActor, action: Action, allocations: readonly Pick<RollingAllocation, "destination" | "destinationId" | "oneOffDestinationId">[], aliases: ReadonlyMap<string, string>) {
  for (const allocation of allocations) {
    const destinationId = allocation.destination?.kind === "one-off" || allocation.oneOffDestinationId
      ? undefined : allocation.destination?.kind === "governed" ? allocation.destination.id : allocation.destinationId;
    assertMenuDestinationScope(actor, action, destinationId, aliases);
    if (allocation.destinationId && allocation.destinationId !== destinationId) {
      assertMenuDestinationScope(actor, action, allocation.destinationId, aliases);
    }
  }
}

export function assertMenuSnapshotMutationScope(snapshot: RollingSnapshot, actor: MenuActor, action: Action, aliases: ReadonlyMap<string, string>) {
  for (const entry of snapshot.entries) assertMenuAllocationsScope(actor, action, entry.allocations, aliases);
  for (const day of snapshot.days) {
    for (const key of Object.keys(day.destinationPax || {})) {
      const site = menuSiteIdentity(key);
      assertMenuDestinationScope(actor, action, site?.kind === "governed" ? site.id : undefined, aliases);
    }
    if (day.oneOffDestinations?.length) assertMenuDestinationScope(actor, action, undefined, aliases);
  }
}

export function assertPublishedMenuDaysScope(days: readonly PublishedMenuDay[], actor: MenuActor, aliases: ReadonlyMap<string, string>) {
  for (const day of days) {
    for (const entry of day.entries) assertMenuAllocationsScope(actor, "publish", entry.allocations, aliases);
    for (const key of Object.keys(day.destinationPax || {})) {
      const site = menuSiteIdentity(key);
      assertMenuDestinationScope(actor, "publish", site?.kind === "governed" ? site.id : undefined, aliases);
    }
    const oneOffIds = new Set(day.entries.flatMap(entry => entry.allocations)
      .flatMap(allocation => allocation.destination?.kind === "one-off" ? [allocation.destination.id] : allocation.oneOffDestinationId ? [allocation.oneOffDestinationId] : []));
    for (const id of Object.keys(day.retainedSiteLineage || {})) assertMenuDestinationScope(actor, "publish", oneOffIds.has(id) ? undefined : id, aliases);
  }
}

export function assertPublishedAmendmentScope(changes: PublishedWeekDemandChangeSet, actor: MenuActor, aliases: ReadonlyMap<string, string>) {
  for (const change of changes.operations) {
    const site = menuSiteIdentity(change.siteId);
    assertMenuDestinationScope(actor, "publish", site?.kind === "governed" ? site.id : undefined, aliases);
  }
}

export function requireSharedMenuWriter(actor: MenuActor) {
  if (!actorCanManageOrganisation(actor) || !actor.allOplocs) throw Object.assign(new Error("This change requires Manage authority across all Menu Planning sites."), { status: 403 });
}
