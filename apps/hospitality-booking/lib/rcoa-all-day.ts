import type { PortalMenuItem } from "./mnk-contract";
import {
  createEmptyRcoaDraft,
  isValidRcoaLondonWallTime,
  RCOA_MAX_SERVICES,
  retainRcoaLinesForOccasion,
  validateRcoaStep,
  type RcoaBookingDraft,
  type RcoaDietaries,
  type RcoaEventType,
  type RcoaLine,
} from "./rcoa-portal";

/**
 * All Day Hospitality: one customer request for an event that runs all day. The event details are entered ONCE; the day is a list
 * of service rows (time, service type, guests, location, items). Each row later becomes one ordinary canonical RCoA Booking with a
 * single service time; rows are linked only by a structured group id. Item selection reuses the existing catalogue screen: a row is
 * viewed as an ordinary RcoaBookingDraft (composeServiceDraft) so every existing rule (categories, choices, minimums, notice,
 * pricing, validation) applies unchanged.
 */
export const RCOA_ALL_DAY = { id: "all_day", label: "All Day Hospitality", description: "An event running all day that needs several catering services." } as const;

export type AllDayService = { id: string; category: RcoaEventType | ""; startTime: string; guestCount: number; location: string; lines: RcoaLine[]; notes: string };
export type AllDayDraft = {
  contact: RcoaBookingDraft["contact"];
  eventName: string;
  eventDate: string;
  defaultGuests: number;
  defaultLocation: string;
  floorLevel: string;
  onsiteContactName: string;
  onsiteContactPhone: string;
  specialInstructions: string;
  dietaries: RcoaDietaries;
  acknowledgements: RcoaBookingDraft["acknowledgements"];
  services: AllDayService[];
};

let serviceCounter = 0;
export const newAllDayServiceId = () => `service-${Date.now().toString(36)}-${(serviceCounter += 1)}`;

const blankService = (draft: Pick<AllDayDraft, "defaultGuests" | "defaultLocation">, id = newAllDayServiceId()): AllDayService =>
  ({ id, category: "", startTime: "", guestCount: draft.defaultGuests, location: draft.defaultLocation, lines: [], notes: "" });

export function createEmptyAllDay(): AllDayDraft {
  const base = createEmptyRcoaDraft();
  const draft: AllDayDraft = {
    contact: base.contact, eventName: "", eventDate: "", defaultGuests: 0, defaultLocation: "", floorLevel: "", onsiteContactName: "", onsiteContactPhone: "",
    specialInstructions: "", dietaries: base.dietaries, acknowledgements: base.acknowledgements, services: [],
  };
  return { ...draft, services: [blankService(draft)] };
}

/** Event-level defaults fill the BLANKS of existing rows (never overriding a row the customer already set) and seed new rows. */
export function applyAllDayDefaults(draft: AllDayDraft): AllDayDraft {
  return { ...draft, services: draft.services.map((service) => ({ ...service, guestCount: service.guestCount > 0 ? service.guestCount : draft.defaultGuests, location: service.location.trim() ? service.location : draft.defaultLocation })) };
}

export function addAllDayService(draft: AllDayDraft, id?: string): AllDayDraft {
  return draft.services.length >= RCOA_MAX_SERVICES ? draft : { ...draft, services: [...draft.services, blankService(draft, id)] };
}

/** Copies service type, guests, location and items; the customer then changes the time (and anything else). */
export function duplicateAllDayService(draft: AllDayDraft, serviceId: string, id?: string): AllDayDraft {
  const index = draft.services.findIndex((service) => service.id === serviceId);
  if (index < 0 || draft.services.length >= RCOA_MAX_SERVICES) return draft;
  const source = draft.services[index];
  const copy: AllDayService = { id: id ?? newAllDayServiceId(), category: source.category, startTime: "", guestCount: source.guestCount, location: source.location, lines: structuredClone(source.lines), notes: "" };
  return { ...draft, services: [...draft.services.slice(0, index + 1), copy, ...draft.services.slice(index + 1)] };
}

export function removeAllDayService(draft: AllDayDraft, serviceId: string): AllDayDraft {
  return draft.services.length <= 1 ? draft : { ...draft, services: draft.services.filter((service) => service.id !== serviceId) };
}

/** Removes one selected item from one service row; everything else (other items, quantities, notes) is untouched. */
export function removeAllDayServiceItem(draft: AllDayDraft, serviceId: string, itemId: string): AllDayDraft {
  return { ...draft, services: draft.services.map((service) => service.id === serviceId ? { ...service, lines: service.lines.filter((line) => line.itemId !== itemId) } : service) };
}

export function updateAllDayService(draft: AllDayDraft, serviceId: string, patch: Partial<Omit<AllDayService, "id">>): AllDayDraft {
  return { ...draft, services: draft.services.map((service) => service.id === serviceId ? { ...service, ...patch } : service) };
}

/** Changing a row's service type keeps only the items that exist for the new type (same rule as the single-offering flow). */
export function changeAllDayServiceCategory(draft: AllDayDraft, serviceId: string, category: RcoaEventType | "", menu: readonly PortalMenuItem[]) {
  const service = draft.services.find((candidate) => candidate.id === serviceId);
  if (!service) return { draft, removed: 0 };
  const lines = category ? retainRcoaLinesForOccasion(service.lines, category, menu) : [];
  return { draft: updateAllDayService(draft, serviceId, { category, lines }), removed: service.lines.length - lines.length };
}

const joinNotes = (draft: AllDayDraft, service?: AllDayService) => [
  draft.eventName.trim() ? `Event: ${draft.eventName.trim()}` : "",
  draft.specialInstructions.trim(),
  service?.notes.trim() ? `Service note: ${service.notes.trim()}` : "",
].filter(Boolean).join("\n\n");

/** The shared event as an ordinary single-offering draft (contact, dietaries, notes and acknowledgements steps reuse it). */
export function composeSharedView(draft: AllDayDraft): RcoaBookingDraft {
  return {
    occasion: "", contact: draft.contact,
    event: { eventDate: draft.eventDate, guestCount: draft.defaultGuests, startTime: "", endTime: "", floorLevel: draft.floorLevel, roomOrArea: draft.defaultLocation, deliveryPoint: "", onsiteContactName: draft.onsiteContactName, onsiteContactPhone: draft.onsiteContactPhone },
    lines: [], dietaries: draft.dietaries, specialInstructions: draft.specialInstructions, acknowledgements: draft.acknowledgements,
  };
}
export function applySharedView(draft: AllDayDraft, view: RcoaBookingDraft): AllDayDraft {
  return {
    ...draft, contact: view.contact, eventDate: view.event.eventDate, defaultGuests: view.event.guestCount, floorLevel: view.event.floorLevel, defaultLocation: view.event.roomOrArea,
    onsiteContactName: view.event.onsiteContactName, onsiteContactPhone: view.event.onsiteContactPhone, dietaries: view.dietaries, specialInstructions: view.specialInstructions, acknowledgements: view.acknowledgements,
  };
}

/** One service row as an ordinary single-offering draft: this is what the existing catalogue screen and validators operate on. */
export function composeServiceDraft(draft: AllDayDraft, serviceId: string): RcoaBookingDraft {
  const service = draft.services.find((candidate) => candidate.id === serviceId) ?? draft.services[0];
  return {
    occasion: service.category, contact: draft.contact,
    event: { eventDate: draft.eventDate, guestCount: service.guestCount, startTime: service.startTime, endTime: "", floorLevel: draft.floorLevel, roomOrArea: service.location, deliveryPoint: "", onsiteContactName: draft.onsiteContactName, onsiteContactPhone: draft.onsiteContactPhone },
    lines: service.lines, dietaries: draft.dietaries, specialInstructions: joinNotes(draft, service), acknowledgements: draft.acknowledgements,
  };
}
/** Writes back only what the item screen may change for a row: its items (the row's own fields are edited on the schedule). */
export function applyServiceItems(draft: AllDayDraft, serviceId: string, view: RcoaBookingDraft): AllDayDraft {
  return updateAllDayService(draft, serviceId, { lines: view.lines });
}

export type AllDayFailure = { step: 1 | 2 | 3 | 4; serviceId?: string; errors: Record<string, string> };

/** Validates the whole request (event, EVERY row, dietaries, acknowledgements) before anything is created. Returns the first failure. */
export function validateAllDay(draft: AllDayDraft, menu: readonly PortalMenuItem[]): AllDayFailure | undefined {
  const shared = composeSharedView(draft);
  const contactErrors = validateRcoaStep(1, shared, menu);
  const dateErrors: Record<string, string> = isValidRcoaLondonWallTime(draft.eventDate, "12:00") ? {} : { eventDate: "Choose a valid event date." };
  const eventErrors = { ...contactErrors, ...dateErrors };
  if (Object.keys(eventErrors).length) return { step: 1, errors: eventErrors };
  for (const service of draft.services) {
    const row = composeServiceDraft(draft, service.id);
    const errors: Record<string, string> = {};
    if (!service.category) errors[`service:${service.id}`] = "Choose a service type.";
    else {
      const timing = validateRcoaStep(2, row, menu);
      for (const key of ["startTime", "guestCount", "location"] as const) if (timing[key]) errors[`${key}:${service.id}`] = timing[key];
      const items = validateRcoaStep(3, row, menu);
      if (Object.keys(items).length) errors[`items:${service.id}`] = Object.values(items)[0];
    }
    if (Object.keys(errors).length) return { step: 2, serviceId: service.id, errors };
  }
  // Dietary counts are entered once for the event, so they must fit the smallest service.
  const smallest = Math.min(...draft.services.map((service) => service.guestCount));
  const dietaryErrors = validateRcoaStep(4, { ...shared, event: { ...shared.event, guestCount: smallest } }, menu);
  if (Object.keys(dietaryErrors).length) return { step: 3, errors: dietaryErrors };
  const acknowledgementErrors = validateRcoaStep(5, shared, menu);
  return Object.keys(acknowledgementErrors).length ? { step: 4, errors: acknowledgementErrors } : undefined;
}

export function summarizeAllDay(draft: AllDayDraft) {
  const times = draft.services.map((service) => service.startTime).filter(Boolean).sort();
  const guests = draft.services.map((service) => service.guestCount).filter((count) => count > 0);
  return { count: draft.services.length, first: times[0] || "", last: times[times.length - 1] || "", minGuests: guests.length ? Math.min(...guests) : 0, maxGuests: guests.length ? Math.max(...guests) : 0 };
}

/** Rows in the order they are submitted and confirmed: by time, then entry order (stable, so a retry produces the same child numbers). */
export const sortedAllDayServices = (draft: AllDayDraft) => draft.services.map((service, index) => ({ service, index })).sort((a, b) => a.service.startTime.localeCompare(b.service.startTime) || a.index - b.index).map((entry) => entry.service);
