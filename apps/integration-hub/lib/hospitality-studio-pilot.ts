import { z } from "zod";
import { dateSchema, idSchema } from "../../shared/hospitality-menu-studio-content";
import { studioReviewStaging } from "../../shared/hospitality-menu-studio-staging";

const pilotScope = z.strictObject({ oplocId: idSchema, menuId: idSchema, firstDate: dateSchema, lastDate: dateSchema })
  .refine(scope => scope.firstDate <= scope.lastDate);

export function studioPilot(env: Record<string, string | undefined> = process.env) {
  if (env.FIKA_STUDIO_HUB_PILOT_ENABLED !== "true" || env.FIKA_RUNTIME_MODE !== "staging" ||
      env.FIREBASE_PROJECT_ID !== studioReviewStaging.projectId || env.FIKA_SESSION_COOKIE_DOMAIN !== ".fikacatering.com" ||
      env.GOOGLE_APPLICATION_CREDENTIALS || env.FIRESTORE_EMULATOR_HOST || env.FIREBASE_AUTH_EMULATOR_HOST ||
      [env.GCLOUD_PROJECT, env.GOOGLE_CLOUD_PROJECT].some(project => project && project !== studioReviewStaging.projectId)) return;

  const checked = pilotScope.safeParse({
    oplocId: env.FIKA_STUDIO_HUB_PILOT_OPLOC, menuId: env.FIKA_STUDIO_HUB_PILOT_MENU_ID,
    firstDate: env.FIKA_STUDIO_HUB_PILOT_FIRST_DATE, lastDate: env.FIKA_STUDIO_HUB_PILOT_LAST_DATE,
  });
  return checked.success ? checked.data : undefined;
}
