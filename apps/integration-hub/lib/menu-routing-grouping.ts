/**
 * Hub Connections shows ONE row per human-facing menu name, but grouping is PRESENTATION ONLY. Every canonical Hospitality Menu Item keeps
 * its own independent governed routing record; display-name equality is not canonical identity, so nothing here propagates a decision from
 * one record to another. The aggregate state below is read-only information derived from the member records and never implies a mutation.
 */
export type GroupableItem = {
  canonicalId: string;
  name: string;
  lifecycleState: string;
  scopes: Array<{ oplocId: string; operationalAreaId?: string }>;
  workstreams: string[];
  routingDecided?: boolean;
};
export type GroupedItem<T extends GroupableItem> = T & {
  sourceIds: string[];
  members: Array<{ canonicalId: string; workstreams: string[]; routingDecided: boolean }>;
  /** Some, but not all, member records have a routing decision. */
  routingPartial: boolean;
  /** Decided member records disagree about the flags. */
  routingInconsistent: boolean;
};

const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && [...a].sort().every((value, index) => value === [...b].sort()[index]);

export function groupMenuItems<T extends GroupableItem>(items: readonly T[]): Array<GroupedItem<T>> {
  const groups = new Map<string, { base: T; members: T[] }>();
  // Prefer an active record as the representative when the same display name has both current and archived site-scoped records.
  for (const item of [...items].sort((a, b) => Number(b.lifecycleState === "active") - Number(a.lifecycleState === "active"))) {
    const key = item.name.trim().toLocaleLowerCase("en-GB");
    const current = groups.get(key);
    if (!current) groups.set(key, { base: item, members: [item] });
    else current.members.push(item);
  }
  return [...groups.values()].map(({ base, members }) => {
    const decided = members.filter((member) => member.routingDecided);
    const scopes = members.flatMap((member) => member.scopes).filter((scope, index, all) => all.findIndex((candidate) => candidate.oplocId === scope.oplocId && candidate.operationalAreaId === scope.operationalAreaId) === index);
    return {
      ...base,
      lifecycleState: members.some((member) => member.lifecycleState === "active") ? "active" : base.lifecycleState,
      scopes,
      sourceIds: members.map((member) => member.canonicalId),
      members: members.map((member) => ({ canonicalId: member.canonicalId, workstreams: member.workstreams, routingDecided: Boolean(member.routingDecided) })),
      workstreams: (decided[0] || base).workstreams,
      routingDecided: decided.length === members.length,
      routingPartial: decided.length > 0 && decided.length < members.length,
      routingInconsistent: decided.some((member) => !sameSet(member.workstreams, decided[0].workstreams)),
    };
  });
}

export type RoutingState = "unclassified" | "in-house" | "delivered-in-only" | "routed" | "conflict";
/** The governed state of ONE canonical item. No saved record is Unclassified, never In house. */
export function memberRoutingState(workstreams: readonly string[], decided: boolean): RoutingState {
  if (!decided) return "unclassified";
  if (workstreams.includes("sandwiches") && workstreams.includes("hospitality")) return "conflict";
  if (!workstreams.length) return "in-house";
  return workstreams.every((value) => value === "delivered_in") ? "delivered-in-only" : "routed";
}
export const MEMBER_ROUTING_LABELS: Record<RoutingState, string> = { unclassified: "Unclassified", "in-house": "In house", "delivered-in-only": "Delivered-In only", routed: "CPU", conflict: "Routing conflict" };

export type GroupRoutingSummary = "unclassified" | "partly-classified" | "mixed-routing" | "conflict" | "consistent";
export function groupRoutingSummary(members: ReadonlyArray<{ workstreams: readonly string[]; routingDecided: boolean }>): GroupRoutingSummary {
  const states = members.map((member) => memberRoutingState(member.workstreams, member.routingDecided));
  if (states.includes("conflict")) return "conflict";
  const decided = members.filter((member) => member.routingDecided);
  if (!decided.length) return "unclassified";
  if (decided.length < members.length) return "partly-classified";
  return decided.every((member) => sameSet(member.workstreams, decided[0].workstreams)) ? "consistent" : "mixed-routing";
}

const PLATFORM_LABELS: Record<string, string> = { mnk: "MNK", rcoa: "RCoA", "angel-court": "Angel Court", cfc: "CFC", "munich-re": "Munich Re" };
/** Which platform a canonical id belongs to, for display only (hospitality-menu-item:<platform>:<key>). */
export function platformLabel(canonicalId: string): string {
  const platform = canonicalId.split(":")[1] || "";
  return PLATFORM_LABELS[platform] || platform.toUpperCase() || canonicalId;
}
