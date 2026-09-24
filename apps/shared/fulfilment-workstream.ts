/** Human-facing operational workstreams carried with fulfilment work. */
export const FULFILMENT_WORKSTREAMS = [
  "Delivered-In",
  "Hospitality",
  "Grab & Go",
  "Fine Dining",
  "Events",
  "CPU Production",
] as const;

export type FulfilmentWorkstream = (typeof FULFILMENT_WORKSTREAMS)[number];

export type FulfilmentWorkstreamSource = {
  sourceDomain?: string;
  origin?: string;
  productionCategory?: string;
};

/**
 * Derive the operator label from explicit upstream classification only.
 * Display labels and destinations are deliberately not inputs here.
 */
export function fulfilmentWorkstream(
  source: FulfilmentWorkstreamSource,
): FulfilmentWorkstream {
  switch (source.productionCategory) {
    case "delivered_in":
      return "Delivered-In";
    case "hospitality":
      return "Hospitality";
    case "grab_and_go":
      return "Grab & Go";
    case "fine_dining":
      return "Fine Dining";
    case "events":
      return "Events";
    default:
      break;
  }

  if (source.origin === "hospitality_booking") return "Hospitality";
  if (source.origin === "grab_and_go" || source.sourceDomain === "grab-and-go")
    return "Grab & Go";
  if (source.origin === "menu_planning" || source.sourceDomain === "menu-planning")
    return "Delivered-In";
  return "CPU Production";
}

