export type DeliveredInView = "today" | "week" | "allergens";

export type DeliveredInLocation = {
  view: DeliveredInView;
  oplocId?: string;
  week?: string;
  day?: string;
};

export function readDeliveredInLocation(search: string): DeliveredInLocation {
  const params = new URLSearchParams(search);
  const requestedView = params.get("view");
  return {
    view: requestedView === "week" || requestedView === "allergens" ? requestedView : "today",
    oplocId: params.get("oplocId") || undefined,
    week: params.get("week") || undefined,
    day: params.get("day") || undefined,
  };
}

export function deliveredInHref(location: DeliveredInLocation, path = "/") {
  const params = new URLSearchParams();
  if (location.view !== "today") params.set("view", location.view);
  if (location.oplocId) params.set("oplocId", location.oplocId);
  if (location.week) params.set("week", location.week);
  if (location.day) params.set("day", location.day);
  const query = params.toString();
  return `${path}${query ? `?${query}` : ""}`;
}
