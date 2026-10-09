import crypto from "node:crypto";
import { workspaceGmailToken } from "./workspace-gmail-dwd";
import { readGmailOAuthFiles, refreshGmailAccessToken } from "./gmail-client";
import type { BookingNotificationKind, BookingNotificationRecord } from "./booking-notifications";
import type { CanonicalBooking } from "./hospitality-booking-service";

export const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";
export type BookingSender = { from: string; replyTo: string; displayName: string; enabled: BookingNotificationKind[]; authenticatedAccount: string; verifiedSendAs: boolean };
const address = (value: string) => /^[^\s<>@,;\r\n]+@[^\s<>@,;\r\n]+\.[^\s<>@,;\r\n]+$/.test(value);

/** Configuration keyed only by the Booking's canonical OPLOC, never by actor/display name. */
export function resolveBookingSender(oplocId: string | undefined, kind: BookingNotificationKind, env: Record<string, string | undefined> = process.env): BookingSender {
  if (!oplocId) throw new Error("Booking sender requires a canonical OPLOC.");
  let senders: Record<string, BookingSender>;
  try { senders = JSON.parse(env.FIKA_HOSPITALITY_EMAIL_SENDERS_JSON || "{}"); } catch { throw new Error("Booking sender configuration is invalid."); }
  const sender = senders[oplocId];
  if (!sender || !address(sender.from || "") || !address(sender.replyTo || "") || !address(sender.authenticatedAccount || "") || !sender.displayName || /[\r\n]/.test(sender.displayName)) throw new Error("Booking site sender is not configured.");
  if (!sender.verifiedSendAs) throw new Error("Booking site From identity has not been verified by its Workspace owner.");
  if (!sender.enabled?.includes(kind)) throw new Error("This site lifecycle notification is disabled.");
  return sender;
}

export function notificationIsCurrent(message: BookingNotificationRecord, booking: CanonicalBooking) {
  if (!message.bookingVersion || message.bookingVersion !== booking.version || message.commercialVersion !== (booking.commercialVersion || 1) || message.oplocId !== booking.service.oplocId) return false;
  if (message.kind === "cancelled") return booking.lifecycleStatus === "Cancelled";
  if (booking.lifecycleStatus === "Cancelled" || booking.lifecycleStatus === "Completed") return false;
  if (message.kind === "confirmed") return ["Sent to CPU", "Approved"].includes(booking.lifecycleStatus);
  return true;
}

export function gmailRawMessage(message: BookingNotificationRecord, sender: BookingSender) {
  const recipients = [...message.to, ...message.cc];
  if (!message.to.length || recipients.some(value => !address(value))) throw new Error("Booking recipients are invalid.");
  const encode = (value: string) => `=?UTF-8?B?${Buffer.from(value).toString("base64")}?=`;
  const identity = crypto.createHash("sha256").update(message.notificationId).digest("hex");
  const boundary = `fika_${identity}`;
  const contact = `\n\nFor questions, reply to ${sender.replyTo}.`;
  const body = (value: string) => Buffer.from(value).toString("base64").match(/.{1,76}/g)?.join("\r\n") || "";
  return [
    `From: ${encode(sender.displayName)} <${sender.from}>`, `Reply-To: ${sender.replyTo}`, `To: ${message.to.join(", ")}`,
    ...(message.cc.length ? [`Cc: ${message.cc.join(", ")}`] : []), `Subject: ${encode(message.subject)}`, `Message-ID: <${identity}@notifications.fikacatering.com>`,
    `Date: ${new Date(message.createdAt).toUTCString()}`, "MIME-Version: 1.0", `Content-Type: multipart/alternative; boundary="${boundary}"`, "",
    `--${boundary}`, "Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64", "", body(message.text + contact),
    `--${boundary}`, "Content-Type: text/html; charset=UTF-8", "Content-Transfer-Encoding: base64", "", body(message.html + `<p>For questions, reply to ${sender.replyTo}.</p>`), `--${boundary}--`, "",
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
