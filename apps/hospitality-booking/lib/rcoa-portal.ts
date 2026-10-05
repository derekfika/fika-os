import type { PortalMenuItem } from "./mnk-contract";

export const rcoaEventTypes = [
  { id: "breakfast", label: "Breakfast", categories: ["Drinks", "Breakfast", "Sweet treats"], noticeType: "standard" },
  { id: "lunch", label: "Lunch", categories: ["Lunch", "Lunch Boxes", "Salads & Sushi", "Grazing Boxes", "Sweet treats"], noticeType: "standard" },
  { id: "afternoon", label: "Afternoon", categories: ["Afternoon", "Sweet treats", "Finger Food", "Drinks"], noticeType: "standard" },
  { id: "meeting_hospitality", label: "Meeting hospitality", categories: ["Drinks", "Breakfast", "Lunch", "Lunch Boxes", "Salads & Sushi", "Sweet treats", "Afternoon"], noticeType: "standard" },
  { id: "finger_food", label: "Finger food", categories: ["Finger Food", "Grazing Boxes", "Sweet treats", "Drinks"], noticeType: "standard" },
  { id: "event_catering", label: "Bowl food & canapes", categories: ["Fork Buffet & Bowl Food", "Canapes", "Grazing Events", "Drinks"], noticeType: "large" },
  { id: "dining", label: "Dining", categories: ["Dining", "Drinks"], noticeType: "large" },
  { id: "bespoke", label: "Bespoke events", categories: ["Bespoke Events", "Grazing Events", "Dining"], noticeType: "large", allowsEmptyOrder: true },
] as const;

export type RcoaEventType = (typeof rcoaEventTypes)[number]["id"];
export type RcoaChoiceValue = string | string[];
export type RcoaLine = { itemId: string; quantity: number; choices: Record<string, RcoaChoiceValue> };
export type RcoaDietaries = {
  hasDietaries: boolean;
  vegetarian: number;
  vegan: number;
  glutenFree: number;
  coeliac: number;
  dairyFree: number;
  halal: number;
  otherCount: number;
  allergyDetails: string;
  severeAllergyAcknowledged: boolean;
  freeText: string;
};
export type RcoaBookingDraft = {
  occasion: RcoaEventType | "";
  contact: { name: string; email: string; phone: string; companyName: string; invoiceReference: string };
  event: { eventDate: string; guestCount: number; startTime: string; endTime: string; floorLevel: string; roomOrArea: string; deliveryPoint: string; onsiteContactName: string; onsiteContactPhone: string };
  lines: RcoaLine[];
  dietaries: RcoaDietaries;
  specialInstructions: string;
  acknowledgements: { quoteSubjectToConfirmation: boolean; noticePolicyAccepted: boolean; dietaryResponsibilityAccepted: boolean };
};

export const rcoaVatNote = "Indicative prices exclude VAT and are subject to confirmation, labour and hire equipment where applicable.";
export const rcoaAcknowledgementLabels = {
  quoteSubjectToConfirmation: "I understand this is a booking request and is subject to confirmation.",
  noticePolicyAccepted: "I understand the notice and cancellation policies.",
  dietaryResponsibilityAccepted: "I have provided all known dietary and allergen requirements.",
} as const;

export function rcoaAllowsEmptyOrder(occasion: string) {
  const event = rcoaEventTypes.find((candidate) => candidate.id === occasion);
  return Boolean(event && "allowsEmptyOrder" in event && event.allowsEmptyOrder);
}

export function createEmptyRcoaDraft(): RcoaBookingDraft {
  return {
    occasion: "",
    contact: { name: "", email: "", phone: "", companyName: "", invoiceReference: "" },
    event: { eventDate: "", guestCount: 0, startTime: "", endTime: "", floorLevel: "", roomOrArea: "", deliveryPoint: "", onsiteContactName: "", onsiteContactPhone: "" },
    lines: [],
    dietaries: { hasDietaries: false, vegetarian: 0, vegan: 0, glutenFree: 0, coeliac: 0, dairyFree: 0, halal: 0, otherCount: 0, allergyDetails: "", severeAllergyAcknowledged: false, freeText: "" },
    specialInstructions: "",
    acknowledgements: { quoteSubjectToConfirmation: false, noticePolicyAccepted: false, dietaryResponsibilityAccepted: false },
  };
}

export function rcoaAllowedCategories(occasion: string, menu: readonly PortalMenuItem[]) {
  const event = rcoaEventTypes.find((candidate) => candidate.id === occasion);
  return event?.categories.filter((category) => menu.some((item) => item.category === category)) || [];
}

export function retainRcoaLinesForOccasion(lines: readonly RcoaLine[], occasion: string, menu: readonly PortalMenuItem[]) {
  if (!menu.length) return [...lines];
  const event = rcoaEventTypes.find((candidate) => candidate.id === occasion);
  if (!event) return [];
  const menuById = new Map(menu.map((item) => [item.id, item]));
  return lines.filter((line) => {
    const item = menuById.get(line.itemId);
    return Boolean(item && event.categories.some((category) => category === item.category));
  });
}

export function filterRcoaMenu(menu: readonly PortalMenuItem[], occasion: string, category: string, search: string) {
  const available = new Set<string>(rcoaAllowedCategories(occasion, menu));
  const query = search.trim().toLocaleLowerCase("en-GB");
  return menu.filter((item) => {
    if (!available.has(item.category)) return false;
    if (category && category !== "all" && item.category !== category) return false;
    if (!query) return true;
    return [item.name, item.description || "", item.category, item.servingInfo || ""]
      .some((value) => value.toLocaleLowerCase("en-GB").includes(query));
  });
}

export function rcoaMinimumQuantity(item: PortalMenuItem) {
  return Math.max(1, Math.floor(Number(item.minimumQuantity) || 1));
}

export function rcoaSuggestedQuantity(item: PortalMenuItem, guestCount: number) {
  if (item.suggestionType !== "ceil_by_guests" || !item.serves || guestCount < 1) return undefined;
  return Math.max(rcoaMinimumQuantity(item), Math.ceil(guestCount / item.serves));
}

export function calculateRcoaTotal(lines: readonly RcoaLine[], menu: readonly PortalMenuItem[]) {
  const byId = new Map(menu.map((item) => [item.id, item]));
  const total = lines.reduce((sum, line) => {
    const item = byId.get(line.itemId);
    return item && Number.isFinite(item.unitPrice) && line.quantity > 0
      ? sum + item.unitPrice * line.quantity
      : sum;
  }, 0);
  return Math.round((total + Number.EPSILON) * 100) / 100;
}

function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

function londonDateKey(value: Date) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(value);
  const output = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return `${output.year}-${output.month}-${output.day}`;
}

function londonWallTimeToUtc(date: string, time: string) {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const wallTimestamp = Date.UTC(year, month - 1, day, hour, minute);
  let guess = wallTimestamp;
  const formatter = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(guess)).filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)]));
    const represented = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
    const correction = wallTimestamp - represented;
    guess += correction;
    if (correction === 0) break;
  }
  const resolved = Object.fromEntries(formatter.formatToParts(new Date(guess)).filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)]));
  if (resolved.year !== year || resolved.month !== month || resolved.day !== day || resolved.hour !== hour || resolved.minute !== minute) return Number.NaN;
  return guess;
}

export function isValidRcoaLondonWallTime(date: string, time: string) {
  return validDate(date) && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time) && Number.isFinite(londonWallTimeToUtc(date, time));
}

function workingDaysUntil(eventDate: string, now: Date) {
  const current = londonDateKey(now);
  const cursor = new Date(`${current}T12:00:00Z`);
  const end = new Date(`${eventDate}T12:00:00Z`);
  if (!Number.isFinite(cursor.getTime()) || !Number.isFinite(end.getTime())) return 0;
  let count = 0;
  while (cursor < end) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) count += 1;
  }
  return count;
}

export function rcoaNoticeWarnings(draft: RcoaBookingDraft, menu: readonly PortalMenuItem[], now = new Date()) {
  if (!validDate(draft.event.eventDate) || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(draft.event.startTime)) return [];
  if (!isValidRcoaLondonWallTime(draft.event.eventDate, draft.event.startTime)) return ["This start time does not occur in Europe/London on the selected date. Choose another time."];
  const warnings: string[] = [];
  const workingDays = workingDaysUntil(draft.event.eventDate, now);
  const hours = (londonWallTimeToUtc(draft.event.eventDate, draft.event.startTime) - now.getTime()) / 3_600_000;
  const event = rcoaEventTypes.find((candidate) => candidate.id === draft.occasion);
  if (hours < 72) warnings.push("This request is within the standard 72-hour notice window. The team will confirm whether it can be accommodated.");
  if (event?.noticeType === "large" && workingDays < 7) warnings.push("This event is inside the usual seven-working-day notice period.");
  if (Object.values(draft.dietaries).some((value) => typeof value === "number" && value > 0) && workingDays < 3) warnings.push("Dietary details are inside the usual three-working-day notice period.");
  const byId = new Map(menu.map((item) => [item.id, item]));
  for (const line of draft.lines) {
    const item = byId.get(line.itemId);
    if (item?.noticeRequiredDays && workingDays < item.noticeRequiredDays) {
      warnings.push(`${item.name} usually needs ${item.noticeRequiredDays} working days' notice.`);
    }
  }
  return [...new Set(warnings)];
}

export function validateRcoaStep(step: number, draft: RcoaBookingDraft, menu: readonly PortalMenuItem[]) {
  const errors: Record<string, string> = {};
  if (step === 0 && !draft.occasion) errors.occasion = "Choose an occasion.";
  if (step === 1) {
    const contact = draft.contact;
    if (!contact.name.trim()) errors.name = "Enter your name.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email.trim())) errors.email = "Enter a valid work email.";
    if (!contact.phone.trim()) errors.phone = "Enter a contact number.";
    if (!contact.companyName.trim()) errors.companyName = "Enter your company name.";
  }
  if (step === 2) {
    if (!validDate(draft.event.eventDate)) errors.eventDate = "Choose a valid event date.";
    if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(draft.event.startTime)) errors.startTime = "Choose a valid start time.";
    else if (!isValidRcoaLondonWallTime(draft.event.eventDate, draft.event.startTime)) errors.startTime = "This time does not occur in Europe/London on the selected date.";
    if (draft.event.endTime && (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(draft.event.endTime) || draft.event.endTime <= draft.event.startTime)) errors.endTime = "End time must be after the start time.";
    if (!Number.isInteger(draft.event.guestCount) || draft.event.guestCount < 1) errors.guestCount = "Enter at least one guest.";
    if (![draft.event.floorLevel, draft.event.roomOrArea, draft.event.deliveryPoint].some((value) => value.trim())) errors.location = "Add a floor, room or delivery point.";
  }
  if (step === 3) {
    const event = rcoaEventTypes.find((candidate) => candidate.id === draft.occasion);
    const selected = draft.lines.filter((line) => line.quantity > 0);
    if (!selected.length && !rcoaAllowsEmptyOrder(draft.occasion)) errors.items = "Choose at least one menu item.";
    const menuById = new Map(menu.map((item) => [item.id, item]));
    for (const line of selected) {
      const item = menuById.get(line.itemId);
      if (!item) { errors.items = "A selected menu item is no longer available. Refresh the menu and try again."; continue; }
      if (!event?.categories.some((category) => category === item.category)) errors.items = `${item.name} is not available for this occasion.`;
      if (!Number.isInteger(line.quantity) || line.quantity < rcoaMinimumQuantity(item)) errors[`quantity:${line.itemId}`] = `${item.name} needs at least ${rcoaMinimumQuantity(item)} ${rcoaMinimumQuantity(item) === 1 ? "item" : "items"}.`;
      if (item.minimumGuests && draft.event.guestCount < item.minimumGuests) errors[`guests:${line.itemId}`] = `${item.name} needs at least ${item.minimumGuests} guests.`;
      for (const group of item.optionGroups || []) {
        const value = line.choices[group.id];
        const values = Array.isArray(value) ? value : typeof value === "string" && value ? [value] : [];
        if (group.required && !values.length) errors[`choice:${line.itemId}:${group.id}`] = `Choose an option for ${item.name}.`;
        if (values.some((choice) => !group.options.some((option) => option.label === choice))) errors[`choice:${line.itemId}:${group.id}`] = `Choose a listed option for ${item.name}.`;
      }
    }
  }
  if (step === 4) {
    const counts = [draft.dietaries.vegetarian, draft.dietaries.vegan, draft.dietaries.glutenFree, draft.dietaries.coeliac, draft.dietaries.dairyFree, draft.dietaries.halal, draft.dietaries.otherCount];
    if (counts.some((count) => !Number.isInteger(count) || count < 0)) errors.dietaryCounts = "Dietary guest counts must be whole numbers at or above zero.";
    if (counts.reduce((sum, count) => sum + count, 0) > draft.event.guestCount) errors.dietaryCounts = "Dietary counts cannot exceed the number of guests.";
    if (draft.dietaries.allergyDetails.trim() && !draft.dietaries.severeAllergyAcknowledged) errors.severeAllergyAcknowledged = "Acknowledge the severe allergy and cross-contamination notice.";
  }
  if (step === 5) {
    for (const [key, accepted] of Object.entries(draft.acknowledgements)) {
      if (!accepted) errors[`acknowledgement:${key}`] = "Confirm this acknowledgement before sending.";
    }
  }
  return errors;
}
