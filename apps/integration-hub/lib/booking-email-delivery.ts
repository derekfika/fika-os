import crypto from "node:crypto";
import { workspaceGmailToken } from "./workspace-gmail-dwd";
import { readGmailOAuthFiles, refreshGmailAccessToken } from "./gmail-client";
import type { BookingNotificationKind, BookingNotificationRecord } from "./booking-notifications";
import type { CanonicalBooking } from "./hospitality-booking-service";
import { EMAIL_FOOTER_MARKER, emailInlineImages } from "./booking-email-template";

export const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";
const RCOA_EMAIL_TEST_OPLOC = "oploc:be0becbe-b6cf-4d7f-9c1e-f36e689feab2";
const RCOA_EMAIL_TEST_RECIPIENT = "derek@fikacatering.com";
const RCOA_EMAIL_SENDER = "rcoa@fikacatering.com";
export type BookingSender = { from: string; replyTo: string; displayName: string; enabled: BookingNotificationKind[]; authenticatedAccount: string; verifiedSendAs: boolean };
const address = (value: string) => /^[^\s<>@,;\r\n]+@[^\s<>@,;\r\n]+\.[^\s<>@,;\r\n]+$/.test(value);

/** Configuration keyed only by the Booking's canonical OPLOC, never by actor/display name. */
export function resolveBookingSender(oplocId: string | undefined, kind: BookingNotificationKind, env: Record<string, string | undefined> = process.env): BookingSender {
  if (!oplocId) throw new Error("Booking sender requires a canonical OPLOC.");
  let senders: Record<string, BookingSender>;
  try { senders = JSON.parse(env.FIKA_HOSPITALITY_EMAIL_SENDERS_JSON || "{}"); } catch { throw new Error("Booking sender configuration is invalid."); }
  const sender = senders[oplocId];
  if (!sender || !address(sender.from || "") || !address(sender.replyTo || "") || !address(sender.authenticatedAccount || "") || !sender.displayName || /[\r\n]/.test(sender.displayName)) throw new Error("Booking site sender is not configured.");
  const scopedRcoaTest = env.FIKA_RUNTIME_MODE === "production"
    && env.FIKA_HOSPITALITY_EMAIL_TEST_MODE_ENABLED === "true"
    && env.FIKA_HOSPITALITY_EMAIL_TEST_RECIPIENT?.trim().toLowerCase() === RCOA_EMAIL_TEST_RECIPIENT
    && oplocId === RCOA_EMAIL_TEST_OPLOC
    && sender.from === RCOA_EMAIL_SENDER
    && sender.replyTo === RCOA_EMAIL_SENDER
    && sender.authenticatedAccount === RCOA_EMAIL_SENDER;
  if (!sender.verifiedSendAs && !scopedRcoaTest) throw new Error("Booking site From identity has not been verified by its Workspace owner.");
  if (!sender.enabled?.includes(kind)) throw new Error("This site lifecycle notification is disabled.");
  return sender;
}

export function notificationIsCurrent(message: BookingNotificationRecord, booking: CanonicalBooking) {
  if (message.kind === "confirmed") {
    if (message.bookingId !== booking.canonicalId || !Number.isSafeInteger(message.bookingVersion) || message.bookingVersion! < 1 || !Number.isSafeInteger(booking.version) || message.bookingVersion! > booking.version || message.commercialVersion !== (booking.commercialVersion || 1) || !message.oplocId || message.oplocId !== booking.service.oplocId) return false;
    if (!["Sent to CPU", "Approved", "Completed"].includes(booking.lifecycleStatus)) return false;
    const committedAt = Date.parse(message.createdAt);
    if (!Number.isFinite(committedAt)) return false;
    // History is ordered at the authoritative transition. Using its position also
    // catches a replacement committed in the same millisecond as this message.
    const history = booking.statusHistory || [];
    const audit = booking.audit || [];
    const isBookkeeping = (action: string) => ["workflow-complete", "workflow-quote-pdf-status"].includes(action);
    const origin = history.findIndex(event => event.changedAt === message.createdAt && ["Sent to CPU", "Approved"].includes(event.status));
    const laterHistory = origin >= 0 ? history.slice(origin + 1) : history.filter(event => Date.parse(event.changedAt) > committedAt);
    if (laterHistory.some(event => {
      if (event.status === "Completed") return false;
      const evidence = audit.filter(entry => entry.at === event.changedAt && entry.reason === event.reason);
      // Repeated status entries can record PDF persistence rather than a new handoff.
      return !evidence.length || evidence.some(entry => !isBookkeeping(entry.action));
    })) return false;
    const isConfirmation = (action: string) => action === "booking-sent-to-cpu" || action === "workflow-approve";
    const auditOrigin = audit.findIndex(event => event.at === message.createdAt && isConfirmation(event.action));
    const laterAudit = auditOrigin >= 0 ? audit.slice(auditOrigin + 1) : audit.filter(event => Date.parse(event.at) > committedAt);
    return !laterAudit.some(event => isConfirmation(event.action) || (event.action.startsWith("workflow-") && !isBookkeeping(event.action)));
  }
  if (!message.bookingVersion || message.bookingVersion !== booking.version || message.commercialVersion !== (booking.commercialVersion || 1) || message.oplocId !== booking.service.oplocId) return false;
  if (message.kind === "cancelled") return booking.lifecycleStatus === "Cancelled";
  if (booking.lifecycleStatus === "Cancelled" || booking.lifecycleStatus === "Completed") return false;
  return true;
}

export function gmailRawMessage(message: BookingNotificationRecord, sender: BookingSender) {
  const recipients = [...message.to, ...message.cc];
  if (!message.to.length || recipients.some(value => !address(value))) throw new Error("Booking recipients are invalid.");
  const encode = (value: string) => `=?UTF-8?B?${Buffer.from(value).toString("base64")}?=`;
  const identity = crypto.createHash("sha256").update(message.notificationId).digest("hex");
  const boundary = `fika_${identity}`;
  const templated = message.html.includes(EMAIL_FOOTER_MARKER);
  const contact = templated ? "" : `\n\nFor questions, reply to ${sender.replyTo}.`;
  const body = (value: string) => Buffer.from(value).toString("base64").match(/.{1,76}/g)?.join("\r\n") || "";
  const wrap = (base64: string) => (base64.match(/.{1,76}/g) || []).join("\r\n");
  const images = emailInlineImages(message.html);
  const htmlPart = ["Content-Type: text/html; charset=UTF-8", "Content-Transfer-Encoding: base64", "", body(message.html + (templated ? "" : `<p>For questions, reply to ${sender.replyTo}.</p>`))];
  // Brand logos travel as inline (cid) parts of the HTML alternative so Gmail and Outlook render them without remote images.
  const relatedBoundary = `fikarel_${identity}`;
  const htmlAlternative = images.length
    ? [`Content-Type: multipart/related; boundary="${relatedBoundary}"`, "", `--${relatedBoundary}`, ...htmlPart,
        ...images.flatMap(image => [`--${relatedBoundary}`, "Content-Type: image/png", "Content-Transfer-Encoding: base64", `Content-ID: <${image.contentId}>`, `Content-Disposition: inline; filename="${image.contentId}.png"`, "", wrap(image.base64)]), `--${relatedBoundary}--`]
    : htmlPart;
  return [
    `From: ${encode(sender.displayName)} <${sender.from}>`, `Reply-To: ${sender.replyTo}`, `To: ${message.to.join(", ")}`,
    ...(message.cc.length ? [`Cc: ${message.cc.join(", ")}`] : []), `Subject: ${encode(message.subject)}`, `Message-ID: <${identity}@notifications.fikacatering.com>`,
    `Date: ${new Date(message.createdAt).toUTCString()}`, "MIME-Version: 1.0", `Content-Type: multipart/alternative; boundary="${boundary}"`, "",
    `--${boundary}`, "Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64", "", body(message.text + contact),
    `--${boundary}`, ...htmlAlternative, `--${boundary}--`, "",
  ].join("\r\n");
}

export async function bookingGmailToken(sender: BookingSender) {
  if (process.env.FIKA_RUNTIME_MODE === "local") {
    const { client, token } = await readGmailOAuthFiles(process.env.GOOGLE_OAUTH_CLIENT_FILE || "", process.env.GOOGLE_OAUTH_TOKEN_FILE || "");
    if (!token.scope?.split(/\s+/).includes(GMAIL_SEND_SCOPE)) throw new Error("Existing Google token does not declare Gmail send consent.");
    if (process.env.FIKA_GMAIL_AUTH_ACCOUNT !== sender.authenticatedAccount) throw new Error("Gmail authenticated account does not match site configuration.");
    return refreshGmailAccessToken(client, token);
  }
  return workspaceGmailToken(sender.authenticatedAccount);
}

export class GmailSendFailure extends Error {
  constructor(public readonly definitelyRejected: boolean, public readonly retryable: boolean, message: string) { super(message); }
}
export async function sendBookingGmail(raw: string, accessToken: string, request: typeof fetch = fetch) {
  let response: Response;
  try { response = await request("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", { method: "POST", headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" }, body: JSON.stringify({ raw: Buffer.from(raw).toString("base64url") }), signal: AbortSignal.timeout(20_000) }); }
  catch { throw new GmailSendFailure(false, false, "Gmail acceptance is uncertain; operator review required before replay."); }
  if (!response.ok) {
    // 5xx may follow acceptance; never automatically send them again.
    throw new GmailSendFailure(response.status >= 400 && response.status < 500, [401, 403, 429].includes(response.status), `Gmail send returned HTTP ${response.status}.`);
  }
  const body = await response.json().catch(() => ({})) as { id?: string };
  if (!body.id) throw new GmailSendFailure(false, false, "Gmail acceptance has no receipt; operator review required.");
  return body.id;
}
