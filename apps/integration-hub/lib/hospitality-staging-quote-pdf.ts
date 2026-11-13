import { assertStagingDriveResource, driveAccessToken, resolveDriveOwner } from "@fika/server-shared/drive-owner";

type QuoteStatus = { expectedVersion: number; revisionId: string; status: "pending" | "saved" | "failed"; driveFileId?: string; driveUrl?: string };
type BookingQuote = { version: number; service: { oplocId?: string }; quoteState?: { currentRevisionId?: string; revisions: Array<{ id: string; stale: boolean }> } };
const invalid = (message: string, status = 422, code = "FIKA_STAGING_QUOTE_PDF_INVALID"): never => { throw Object.assign(new Error(message), { status, code }); };
const fileIdPattern = /^[A-Za-z0-9_-]{1,200}$/;

/** Verify a standalone staging PDF before it can make the current quote eligible for CPU. */
export async function verifyStagingQuotePdfStatus<T extends QuoteStatus>(
  change: T,
  booking: BookingQuote,
  fetcher: typeof fetch = fetch,
  tokenForOploc: (oplocId: string) => Promise<string> = async oplocId => driveAccessToken(resolveDriveOwner({ type: "oploc-workspace", oplocId })),
): Promise<T> {
  if (process.env.FIKA_RUNTIME_MODE !== "staging") return change;
  const current = booking.quoteState?.revisions.find(revision => revision.id === change.revisionId);
  if (booking.version !== change.expectedVersion || booking.quoteState?.currentRevisionId !== change.revisionId || !current || current.stale) return invalid("The current quote changed. Refresh before recording its PDF.", 409);
  if (!booking.service.oplocId) return invalid("The quote has no canonical OPLOC.");
  let token: string;
  try { token = await tokenForOploc(booking.service.oplocId); }
  catch { return invalid("Staging quote PDF access requires a verified isolated Drive session.", 404, "FIKA_STAGING_DRIVE_ISOLATION_UNVERIFIED"); }
  if (change.status !== "saved") {
    if (change.driveFileId || change.driveUrl) return invalid("A quote without a saved PDF cannot carry a Drive pointer.");
    return change;
  }
  const fileId = change.driveFileId?.trim();
  if (!fileId || !fileIdPattern.test(fileId)) return invalid("A saved quote needs a valid Drive file ID.");
  const authorization = `Bearer ${token}`;
  const metadata = await fetcher(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?supportsAllDrives=true&fields=id,mimeType,trashed,size`, { headers: { authorization }, redirect: "error", signal: AbortSignal.timeout(5000), cache: "no-store" });
  if (!metadata.ok) return invalid("The staging quote PDF could not be verified.");
  const file = await metadata.json() as { id?: string; mimeType?: string; trashed?: boolean; size?: string | number };
  if (file.id !== fileId || file.mimeType !== "application/pdf" || file.trashed || !(Number(file.size) > 0)) return invalid("The staging quote artifact is not a current PDF.");
  try { await assertStagingDriveResource(fileId, authorization, fetcher); }
  catch { return invalid("The quote PDF is outside the approved staging Drive root."); }
  return { ...change, driveFileId: fileId, driveUrl: `https://drive.google.com/file/d/${encodeURIComponent(fileId)}/view` };
}
