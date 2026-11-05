import { SERVICE_IDS, resolveServiceCategories, type ServiceId } from "@fika/server-shared/hospitality-service-layout";
import type { HospitalityServiceVisibility } from "./rcoa-service-visibility";

const labels: Record<ServiceId, { label: string; copy: string }> = {
  breakfast: { label: "Breakfast", copy: "Start the day brilliantly." },
  lunch: { label: "Lunch", copy: "A considered lunchtime spread." },
  afternoon: { label: "Afternoon", copy: "Something sweet, savoury or refreshing." },
  meeting_hospitality: { label: "Meeting hospitality", copy: "Everything your meeting needs." },
  finger_food: { label: "Finger food", copy: "A relaxed spread for your event." },
  event_catering: { label: "Events", copy: "Food made for a bigger moment." },
  dining: { label: "Dinner", copy: "A seated meal for your guests." },
  bespoke: { label: "Something bespoke", copy: "Tell us what you have in mind." },
};

/** Only services present in the verified package layout are visible to mapped-site portals. */
export function visibleHospitalityServiceOptions(visibility: HospitalityServiceVisibility | undefined) {
  if (!visibility) return [];
  return SERVICE_IDS.flatMap(id => {
    const categories = resolveServiceCategories(visibility.layout, visibility.oplocId, id);
    return categories === undefined ? [] : [{ id, ...labels[id], categories: [...categories] }];
  });
}