import { z } from "zod";
export const EventTypes = [
  "breakfast",
  "lunch",
  "afternoon",
  "meeting_hospitality",
  "finger_food",
  "event_catering",
  "dining",
  "bespoke",
] as const;
export const BookingInput = z
  .object({
    clientName: z.string().trim().min(1),
    clientEmail: z.string().email(),
    clientPhone: z.string().trim().min(1),
    companyName: z.string().trim().min(1),
    requesterName: z.string().trim().min(1).optional(),
    requesterEmail: z.string().email().optional(),
    requesterPhone: z.string().trim().min(1).optional(),
    requesterCompany: z.string().trim().min(1).optional(),
    clientCompany: z.string().trim().min(1).optional(),
    invoiceReference: z.string().trim().max(200).optional(),
    eventDate: z.string().date(),
    startTime: z.string().regex(/^\d{2}:\d{2}$/),
    endTime: z
      .string()
      .regex(/^\d{2}:\d{2}$/)
      .optional(),
    guestCount: z.coerce.number().int().positive(),
    floorLevel: z.string().trim().optional(),
    roomOrArea: z.string().trim().optional(),
    deliveryPoint: z.string().trim().optional(),
    eventType: z.enum(EventTypes),
    dietaryDetails: z.string().trim().optional(),
    specialInstructions: z.string().trim().optional(),
    acknowledgements: z.object({
      quoteSubjectToConfirmation: z.literal(true),
      noticePolicyAccepted: z.literal(true),
      dietaryResponsibilityAccepted: z.literal(true),
    }),
  })
  .superRefine((value, context) => {
    if (!value.floorLevel && !value.roomOrArea && !value.deliveryPoint)
      context.addIssue({
        code: "custom",
        path: ["roomOrArea"],
        message: "Add a floor, room or delivery point.",
      });
    if (value.endTime && value.endTime <= value.startTime)
      context.addIssue({
        code: "custom",
        path: ["endTime"],
        message: "End time must be after start time.",
      });
  });
export type PortalMenuItem = {
  canonicalId: string;
  id: string;
  name: string;
  description?: string;
  category: string;
  unitPrice: number;
  vatRate: number | null;
  dietaryInformation: string[];
  allergenInformation: string[];
  minimumQuantity?: number;
  minimumGuests?: number;
  noticeRequiredDays?: number;
  servingInfo?: string;
  optionGroups?: Array<{
    id: string;
    label: string;
    selectionType: string;
    required: boolean;
    options: Array<{ id: string; label: string }>;
  }>;
};
export function portalBookingId(siteKey = "mnk") {
  return `${siteKey.toUpperCase().replace(/[^A-Z0-9]+/g, "-")}-${new Date()
    .toISOString()
    .replace(/[-:.TZ]/g, "")
    .slice(0, 14)}-${crypto.randomUUID().slice(0, 4).toUpperCase()}`;
}
