export { governedRoutingPlatforms } from "./hospitality-cpu-routing";

/** Report-only classification of one canonical item's saved routing (undefined = no record). */
export function memberStateForReport(workstreams: readonly string[] | undefined): "unclassified" | "in-house" | "sandwiches" | "hospitality" | "conflict" | "delivered-in" {
  if (!workstreams) return "unclassified";
  const sandwiches = workstreams.includes("sandwiches");
  const hospitality = workstreams.includes("hospitality");
  if (sandwiches && hospitality) return "conflict";
  if (sandwiches) return "sandwiches";
  if (hospitality) return "hospitality";
  return workstreams.includes("delivered_in") ? "delivered-in" : "in-house";
}
