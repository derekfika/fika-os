import { assertStagingDriveResource, driveAccessToken, resolveDriveOwner } from "@fika/server-shared/drive-owner";
import type { CanonicalBooking } from "./hospitality-booking-service";
import type { DashboardQuoteSettings } from "./quote-engine";
import { RCOA_HOSPITALITY_OPLOC_ID } from "./booking-email-site-identities";

const base = "https://www.googleapis.com/drive/v3/files";
const folderIdFrom = (value: string | undefined) => {
  const configured = value?.trim() || "";
  return configured.match(/\/folders\/([A-Za-z0-9_-]+)/)?.[1] || configured;
};

export async function resolveGroupQuoteTarget(
  booking: CanonicalBooking,
  settings: DashboardQuoteSettings,
  fetcher: typeof fetch = fetch,
  tokenForOploc: (oplocId: string) => Promise<string> = async oplocId => driveAccessToken(resolveDriveOwner({ type: "oploc-workspace", oplocId })),
) {
  const oplocId = booking.service.oplocId;
  if (!oplocId) throw new Error("The quote has no canonical OPLOC.");
  const staging = process.env.FIKA_RUNTIME_MODE === "staging";
  const isCanonicalRcoa = booking.service.portalSiteId === "rcoa" && oplocId === RCOA_HOSPITALITY_OPLOC_ID;
  const configured = staging && isCanonicalRcoa
    ? process.env.FIKA_STAGING_RCOA_QUOTE_FOLDER_ID
    : staging
      ? settings.googleQuoteFolderId
      : settings.googleQuoteFolderId || settings.googleDriveFolderId || resolveDriveOwner({ type: "oploc-workspace", oplocId }).configuredRootFolderId;
  const folderId = folderIdFrom(configured);
  if (!folderId) throw new Error("Configure the location's quote Drive folder before generating a group quote.");

  if (staging) {
    const token = await tokenForOploc(oplocId);
    const authorization = `Bearer ${token}`;
    await assertStagingDriveResource(folderId, authorization, fetcher);
    const response = await fetcher(`${base}/${encodeURIComponent(folderId)}?supportsAllDrives=true&fields=id,mimeType,trashed,driveId,capabilities(canAddChildren)`, {
      headers: { authorization }, redirect: "error", signal: AbortSignal.timeout(5_000), cache: "no-store",
    });
    if (!response.ok) throw new Error("The staging quote destination could not be verified.");
    const folder = await response.json() as { id?: string; mimeType?: string; trashed?: boolean; driveId?: string; capabilities?: { canAddChildren?: boolean } };
    if (folder.id !== folderId || folder.mimeType !== "application/vnd.google-apps.folder" || folder.trashed || folder.driveId !== process.env.FIKA_STAGING_DRIVE_SHARED_DRIVE_ID || folder.capabilities?.canAddChildren !== true) {
      throw new Error("The staging quote destination is outside the approved writable Drive root.");
    }
  }

  return { folderId, oplocId };
}
