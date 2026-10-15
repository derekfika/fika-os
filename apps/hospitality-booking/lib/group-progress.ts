import { groupLifecycleStatus, type GroupCpuEvidence } from "../../shared/hospitality-group-lifecycle";
import type { HospitalityBookingGroup } from "../../shared/hospitality-group-quotes";

/** One bounded batch per 25 current required orders; no template, mail or artifact generation. */
export async function hydrateGroupProgress(groups: HospitalityBookingGroup[], read: (orderIds: string[]) => Promise<GroupCpuEvidence[]>) {
  const ids = [...new Set(groups.filter(g => g.status === "Sent to CPU").flatMap(g => g.services.flatMap(s => s.production?.quoteCurrent && s.routing?.status === "cpu_required" ? [s.production.orderId] : [])))];
  const evidence: Record<string, GroupCpuEvidence> = {};
  const unavailable = new Set<string>();
  for (let start = 0; start < ids.length; start += 25) {
    const batch = ids.slice(start, start + 25);
    try {
      const results = await read(batch);
      for (const result of results) if (batch.includes(result.orderId)) evidence[result.orderId] = result;
      for (const id of batch) if (!evidence[id]) unavailable.add(id);
    } catch { batch.forEach(id => unavailable.add(id)); }
  }
  return groups.map(group => {
    const missing = group.services.some(s => s.production && unavailable.has(s.production.orderId));
    return { ...group, status: missing ? "Needs attention" as const : groupLifecycleStatus(group, evidence) };
  });
}
