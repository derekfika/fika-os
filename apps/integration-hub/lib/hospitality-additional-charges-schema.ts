import { z } from "zod";

const ManualChargeInput = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{8,80}$/),
  kind: z.literal("manual"),
  category: z.enum(["equipment", "service", "other"]),
  label: z.string().trim().min(1).max(120),
  quantity: z.number().positive().max(1000),
  unitNet: z.number().positive().max(1_000_000),
}).strict();

const LabourChargeInput = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{8,80}$/),
  kind: z.literal("labour"),
  category: z.literal("labour"),
  label: z.string().trim().min(1).max(120),
  labour: z.object({
    roleId: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/).optional(),
    roleLabel: z.string().trim().min(1).max(100),
    staffCount: z.number().int().min(1).max(100),
    hoursPerPerson: z.number().positive().max(168),
    hourlyRate: z.number().positive().max(1000),
    multiplier: z.number().min(0.25).max(5),
    rateSource: z.enum(["configured", "custom"]),
  }).strict(),
}).strict();

export const bookingAdditionalChargesSchema = z.array(
  z.discriminatedUnion("kind", [ManualChargeInput, LabourChargeInput]),
).max(25);

export const labourRateSettingsSchema = z.array(z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/),
  label: z.string().trim().min(1).max(100),
  hourlyRate: z.number().min(0).max(1000).optional(),
}).strict()).max(25);
