const result = (id, status, detail) => ({ id, status, detail });

export function evaluateInvariants(state) {
  const menu = state.menu || {};
  const cpu = state.cpu || {};
  const di = state.deliveredIn || {};
  const date = state.target?.serviceDate;
  const published = menu.status === "published";
  const results = [];
  results.push(result("MENU-001", published && menu.targetHasAllocations === true ? "PASS" : !menu.available ? "UNKNOWN" : "PASS", published && menu.targetHasAllocations === true ? "Published Menu day has target OPLOC allocations." : "Not applicable for this target."));
  const diWithdrawn = di.projectionState === "withdrawn" || di.withdrawnServiceDates?.includes(date);
  const diUnavailable = di.projectionState === "unavailable" || di.unavailableServiceDates?.includes(date);
  results.push(result("DI-001", !menu.available ? "UNKNOWN" : published && (cpu.reviewStatus === "pending" || cpu.reviewStatus === "unknown" || cpu.available === false) ? (diWithdrawn ? "FAIL" : di.available ? "PASS" : "UNKNOWN") : "PASS", "CPU unavailability must not classify a published Menu day as withdrawn."));
  const cpuUnavailable = ["unavailable", "pending", "unknown"].includes(cpu.reviewStatus) || cpu.available === false;
  const menuDisappeared = published && menu.targetHasAllocations === true && (!di.targetDatePresent || ["missing", "unknown"].includes(di.menu));
  results.push(result("DI-002", !menu.available ? "UNKNOWN" : cpuUnavailable && menuDisappeared ? "FAIL" : cpuUnavailable && !di.available ? "UNKNOWN" : "PASS", "CPU unavailable/pending does not by itself make the Menu day disappear."));
  if (di.freshness === "current" && di.completeness === "complete") {
    const diHash = di.sourceLineage?.menu?.contentHash;
    results.push(result("DI-003", menu.contentHash && diHash ? (menu.contentHash === diHash ? "PASS" : "FAIL") : "UNKNOWN", "Current complete Delivered-In Menu lineage matches the authoritative Menu day hash."));
  } else results.push(result("DI-003", "UNKNOWN", "Delivered-In is not current and complete, so lineage cannot be asserted."));
  results.push(result("DI-004", diUnavailable && diWithdrawn ? "FAIL" : Array.isArray(di.unavailableServiceDates) && Array.isArray(di.withdrawnServiceDates) ? "PASS" : "UNKNOWN", "A date must not be both unavailable and withdrawn."));
  if (cpu.reviewStatus === "signed") {
    const cpuHash = cpu.sourceHash || di.sourceLineage?.cpu?.sourceBundleHash;
    results.push(result("CPU-001", menu.contentHash && cpuHash ? (menu.contentHash === cpuHash ? "PASS" : "FAIL") : "UNKNOWN", "Signed CPU package source hash matches the current published Menu day hash."));
  } else results.push(result("CPU-001", "UNKNOWN", "No signed CPU package evidence was available."));
  return results;
}

export function invariantSummary(results) {
  return { pass: results.filter((item) => item.status === "PASS").length, fail: results.filter((item) => item.status === "FAIL").length, unknown: results.filter((item) => item.status === "UNKNOWN").length, status: results.some((item) => item.status === "FAIL") ? "FAIL" : results.some((item) => item.status === "UNKNOWN") ? "UNKNOWN" : "PASS" };
}
