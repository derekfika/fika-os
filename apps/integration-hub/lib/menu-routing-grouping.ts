/**
 * Hub Connections shows ONE row per human-facing menu name so Production visibility can be set once and applied to every matching site
 * record (existing, deliberate UX; canonical records and offerings stay separate). The row must still report the governed state of its
 * member records truthfully: a row is only "decided" when EVERY member has a saved routing record, and the flags shown come from the
 * decided members rather than from whichever record happened to sort first.
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
