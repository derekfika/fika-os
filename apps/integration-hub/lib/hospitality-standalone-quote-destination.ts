import type { DashboardQuoteSettings } from "./quote-engine";
import { RCOA_HOSPITALITY_OPLOC_ID } from "./booking-email-site-identities";

type BookingSite = { service: { portalSiteId?: string; oplocId?: string } };

/** Staging RCoA standalone quotes must use the isolated Quotes child, never a persisted production folder. */
export function stagingStandaloneQuoteDestination<T extends BookingSite>(
  booking: T,
  settings: DashboardQuoteSettings,
  env: Readonly<Record<string, string | undefined>> = process.env,
): DashboardQuoteSettings {
  if (env.FIKA_RUNTIME_MODE !== "staging" || booking.service.portalSiteId !== "rcoa" || booking.service.oplocId !== RCOA_HOSPITALITY_OPLOC_ID) return settings;
  const folderId = env.FIKA_STAGING_RCOA_QUOTE_FOLDER_ID?.trim();
  if (!folderId) throw new Error("The isolated staging RCoA quote destination is not configured.");
  return { ...settings, googleQuoteFolderId: folderId };
}
