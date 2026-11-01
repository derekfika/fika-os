import { z } from "zod";
import { localRcoaMenuCatalogue } from "./local-rcoa-menu";
import type { PortalMenuItem } from "./mnk-contract";
import { isValidRcoaLondonWallTime, RCOA_MAX_SERVICES, rcoaAllowsEmptyOrder, rcoaChildReference, rcoaEventTypes, rcoaVatNote } from "./rcoa-portal";
import { rcoaServiceCategories, RCOA_SERVICE_SETTINGS_UNAVAILABLE, type RcoaServiceVisibility } from "./rcoa-service-visibility";

const eventTypeIds = rcoaEventTypes.map((event) => event.id) as [string, ...string[]];

const RCOA_REFERENCE = /^RCOA-[A-Z0-9-]{8,80}$/i;
/** Structured link between the ordinary bookings created from one All Day Hospitality request (one booking per service row). */
export const RcoaBookingGroupSchema = z.object({
  id: z.string().regex(RCOA_REFERENCE),
  sequence: z.number().int().min(1).max(RCOA_MAX_SERVICES),
  size: z.number().int().min(1).max(RCOA_MAX_SERVICES),
}).strict();

export const RcoaBookingRequestSchema = z.object({
  bookingId: z.string().regex(RCOA_REFERENCE),
  bookingGroup: RcoaBookingGroupSchema.optional(),
  submittedAt: z.string().datetime(),
  client: z.object({
    name: z.string().trim().min(1).max(200),
    email: z.string().trim().email().max(320),
    phone: z.string().trim().min(1).max(80),
    companyName: z.string().trim().min(1).max(200),
    invoiceReference: z.string().trim().max(200).optional(),
  }).strict(),
  event: z.object({
    eventDate: z.string().date(),
    startTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
    endTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/).optional(),
    guestCount: z.number().int().positive(),
    floorLevel: z.string().trim().max(200).optional(),
    roomOrArea: z.string().trim().max(200).optional(),
    deliveryPoint: z.string().trim().max(200).optional(),
    onsiteContactName: z.string().trim().max(200).optional(),
    onsiteContactPhone: z.string().trim().max(80).optional(),
  }).strict(),
  order: z.object({
    eventType: z.enum(eventTypeIds),
    items: z.array(z.object({
      itemId: z.string().trim().min(1).max(200),
      quantity: z.number().int().positive(),
      choices: z.array(z.object({
        id: z.string().trim().min(1).max(100),
        value: z.union([z.string().max(1000), z.array(z.string().max(1000)).max(30)]),
      }).strict()).max(30).optional(),
    }).strict()).max(100),
  }).strict(),
  dietaries: z.object({
    hasDietaries: z.boolean(),
    vegetarian: z.number().int().min(0),
    vegan: z.number().int().min(0),
    glutenFree: z.number().int().min(0),
    coeliac: z.number().int().min(0),
    dairyFree: z.number().int().min(0),
    halal: z.number().int().min(0),
    otherCount: z.number().int().min(0),
    allergyDetails: z.string().max(4000),
    severeAllergyAcknowledged: z.boolean(),
    freeText: z.string().max(4000),
  }).strict(),
  acknowledgements: z.object({
    quoteSubjectToConfirmation: z.literal(true),
    noticePolicyAccepted: z.literal(true),
    dietaryResponsibilityAccepted: z.literal(true),
  }).strict(),
  specialInstructions: z.string().max(4000).optional(),
}).strict();

export type RcoaBookingRequest = z.infer<typeof RcoaBookingRequestSchema>;

/** What booking validation needs from a menu item, whether it came from the governed catalogue or the legacy local snapshot. */
export type TrustedMenuItem = {
  id: string; name: string; category: string; description?: string; servingInfo?: string; unitPrice: number;
  minimumQuantity: number; minimumGuests?: number;
  optionGroups: Array<{ id: string; label: string; selectionType: string; required?: boolean; options: Array<{ label: string }> }>;
};

/** The legacy local snapshot, active items only. Used only when no governed menu is supplied (tests / local runtime). */
export function localTrustedMenu(): TrustedMenuItem[] {
  return localRcoaMenuCatalogue.items.filter((item) => item.lifecycleState === "active").map((item) => ({
    id: item.source.sourceItemId, name: item.name, category: item.category, description: item.description, servingInfo: item.pricing.servingInfo,
    unitPrice: item.pricing.unitPrice, minimumQuantity: item.orderingConstraints.minimumQuantity, minimumGuests: item.orderingConstraints.minimumGuests || undefined,
    optionGroups: item.optionGroups as TrustedMenuItem["optionGroups"],
  }));
}

/** The governed portal menu (what the customer was shown) as trusted items. */
export function governedTrustedMenu(menu: readonly PortalMenuItem[]): TrustedMenuItem[] {
  return menu.map((item) => ({
    id: item.id, name: item.name, category: item.category, description: item.description, servingInfo: item.servingInfo, unitPrice: item.unitPrice,
    minimumQuantity: item.minimumQuantity ?? 1, minimumGuests: item.minimumGuests,
    optionGroups: (item.optionGroups || []) as TrustedMenuItem["optionGroups"],
  }));
}

function selectedChoices(
  item: TrustedMenuItem,
  requested: RcoaBookingRequest["order"]["items"][number]["choices"],
) {
  const supplied = requested || [];
  const byId = new Map(supplied.map((choice) => [choice.id, choice.value]));
  if (byId.size !== supplied.length) throw new Error(`Choose each option only once for ${item.name}.`);
  const knownGroups = new Set(item.optionGroups.map((group) => group.id));
  if (supplied.some((choice) => !knownGroups.has(choice.id))) throw new Error(`An option is not available for ${item.name}.`);

  return item.optionGroups.map((group) => {
    const raw = byId.get(group.id);
    const values = Array.isArray(raw) ? raw : typeof raw === "string" && raw ? [raw] : [];
    const selected = [...new Set(values.map((value) => value.trim()).filter(Boolean))];
    if (group.required && !selected.length) throw new Error(`Choose an option for ${item.name}.`);
    if (selected.some((value) => !group.options.some((option) => option.label === value))) {
      throw new Error(`Choose a listed option for ${item.name}.`);
    }
    if (["multi", "checkbox", "checkboxes"].includes(group.selectionType.toLowerCase())) {
      return { id: group.id, label: group.label, value: selected.join(", "), values: selected };
    }
    if (selected.length > 1) throw new Error(`Choose one option for ${item.name}.`);
    return { id: group.id, label: group.label, value: selected[0] || "" };
  });
}

export function buildTrustedRcoaHubPayload(value: unknown, governedMenu: readonly PortalMenuItem[] | undefined, visibility: RcoaServiceVisibility | undefined) {
  const request = RcoaBookingRequestSchema.parse(value);
  if (request.bookingGroup) {
    if (request.bookingGroup.sequence > request.bookingGroup.size) throw new Error("The service position is outside its request.");
    if (request.bookingId.toUpperCase() !== rcoaChildReference(request.bookingGroup.id, request.bookingGroup.sequence).toUpperCase()) throw new Error("The booking reference does not match its request group.");
  }
  if (!isValidRcoaLondonWallTime(request.event.eventDate, request.event.startTime)) {
    throw new Error("The start time does not occur in Europe/London on the selected date.");
  }
  if (request.event.endTime && !isValidRcoaLondonWallTime(request.event.eventDate, request.event.endTime)) {
    throw new Error("The end time does not occur in Europe/London on the selected date.");
  }
  if (request.event.endTime && request.event.endTime <= request.event.startTime) {
    throw new Error("End time must be after the start time.");
  }
  if (!request.event.floorLevel?.trim()) throw new Error("Enter the floor level.");
  if (!request.event.roomOrArea?.trim()) throw new Error("Enter the room or area.");
  const categories = rcoaServiceCategories(visibility, request.order.eventType);
  if (!categories) throw new Error(visibility ? "This service is no longer offered. Refresh the menu and choose another occasion." : RCOA_SERVICE_SETTINGS_UNAVAILABLE);
  if (!request.order.items.length && !rcoaAllowsEmptyOrder(request.order.eventType)) {
    throw new Error("Choose at least one menu item.");
  }
  if (new Set(request.order.items.map((item) => item.itemId)).size !== request.order.items.length) {
    throw new Error("Each menu item can appear only once in the request.");
  }
  const menuById = new Map((governedMenu ? governedTrustedMenu(governedMenu) : localTrustedMenu()).map((item) => [item.id, item]));
  const items = request.order.items.map((requested) => {
    const item = menuById.get(requested.itemId);
    if (!item) throw new Error("A menu item is no longer available. Refresh the menu and try again.");
    if (!categories.includes(item.category)) throw new Error(`${item.name} is not available for this occasion. Refresh the menu and review your selections.`);
    if (requested.quantity < item.minimumQuantity) {
      throw new Error(`${item.name} requires a minimum quantity of ${item.minimumQuantity}.`);
    }
    if (item.minimumGuests && request.event.guestCount < item.minimumGuests) {
      throw new Error(`${item.name} requires at least ${item.minimumGuests} guests.`);
    }
    return {
      itemId: item.id,
      itemName: item.name,
      category: item.category,
      description: item.description,
      servingInfo: item.servingInfo,
      unitPrice: item.unitPrice,
      quantity: requested.quantity,
      lineTotal: Math.round((item.unitPrice * requested.quantity + Number.EPSILON) * 100) / 100,
      choices: selectedChoices(item, requested.choices),
    };
  });
  const dietaryCount = request.dietaries.vegetarian + request.dietaries.vegan + request.dietaries.glutenFree + request.dietaries.coeliac + request.dietaries.dairyFree + request.dietaries.halal + request.dietaries.otherCount;
  if (dietaryCount > request.event.guestCount) throw new Error("Dietary counts cannot exceed the number of guests.");
  if (request.dietaries.allergyDetails.trim() && !request.dietaries.severeAllergyAcknowledged) {
    throw new Error("Acknowledge the severe allergy and cross-contamination notice.");
  }
  const netTotal = Math.round((items.reduce((sum, item) => sum + item.lineTotal, 0) + Number.EPSILON) * 100) / 100;
  const email = request.client.email.toLowerCase();

  return {
    bookingId: request.bookingId,
    ...(request.bookingGroup ? { bookingGroup: request.bookingGroup } : {}),
    submittedAt: request.submittedAt,
    status: "New",
    site: "RCoA Hospitality",
    siteId: "rcoa",
    client: {
      ...request.client,
      email,
      requester: {
        name: request.client.name,
        email,
        phone: request.client.phone,
        companyName: request.client.companyName,
      },
    },
    event: request.event,
    order: { eventType: request.order.eventType, items, netTotal, vatNote: rcoaVatNote },
    dietaries: { ...request.dietaries, hasDietaries: dietaryCount > 0 || Boolean(request.dietaries.allergyDetails || request.dietaries.freeText) },
    acknowledgements: request.acknowledgements,
    specialInstructions: request.specialInstructions || "",
  };
}

/** Envelope for a confirmed EXISTING id only. Hub must refuse creation and return its stored snapshot unchanged. */
export function buildRcoaReplayHubPayload(value: unknown): ReturnType<typeof buildTrustedRcoaHubPayload> {
  const request = RcoaBookingRequestSchema.parse(value);
  if (request.bookingGroup && (request.bookingGroup.sequence > request.bookingGroup.size || request.bookingId.toUpperCase() !== rcoaChildReference(request.bookingGroup.id, request.bookingGroup.sequence).toUpperCase())) throw new Error("The booking reference does not match its request group.");
  const email = request.client.email.toLowerCase();
  return {
    bookingId: request.bookingId, ...(request.bookingGroup ? { bookingGroup: request.bookingGroup } : {}), submittedAt: request.submittedAt,
    status: "New", site: "RCoA Hospitality", siteId: "rcoa",
    client: { ...request.client, email, requester: { name: request.client.name, email, phone: request.client.phone, companyName: request.client.companyName } },
    event: request.event,
    order: { eventType: request.order.eventType, items: request.order.items.map(line => ({ itemId: line.itemId, itemName: line.itemId, category: "", description: undefined, servingInfo: undefined, unitPrice: 0, quantity: line.quantity, lineTotal: 0, choices: [] })), netTotal: 0, vatNote: rcoaVatNote },
    dietaries: request.dietaries, acknowledgements: request.acknowledgements, specialInstructions: request.specialInstructions || "",
  };
}
