import { z } from "zod";
import { studioReviewStaging } from "../../shared/hospitality-menu-studio-staging";

const scopeSchema = z.strictObject({
  oplocId: z.string().regex(/^oploc:[a-zA-Z0-9:._-]+$/), bookingId: z.string().regex(/^STUDIO-UAT-[A-Z0-9-]+$/).max(120),
  firstDate: z.iso.date(), lastDate: z.iso.date(),
}).refine(scope => scope.firstDate <= scope.lastDate);

export const studioHospitalityOrigin = "https://hospitality-staging.fikacatering.com";

export function studioPortalPilot(env: Record<string, string | undefined> = process.env) {
  if (env.FIKA_STUDIO_HOSPITALITY_PILOT_ENABLED !== "true" || env.FIKA_RUNTIME_MODE !== "staging" ||
      env.FIREBASE_PROJECT_ID !== studioReviewStaging.projectId || env.FIKA_HUB_BASE_URL !== studioReviewStaging.hubOrigin) return;
  const parsed = scopeSchema.safeParse({
    oplocId: env.FIKA_STUDIO_HOSPITALITY_PILOT_OPLOC, bookingId: env.FIKA_STUDIO_HOSPITALITY_PILOT_SOURCE_BOOKING_ID,
    firstDate: env.FIKA_STUDIO_HOSPITALITY_PILOT_FIRST_DATE, lastDate: env.FIKA_STUDIO_HOSPITALITY_PILOT_LAST_DATE,
  });
  return parsed.success ? parsed.data : undefined;
}
