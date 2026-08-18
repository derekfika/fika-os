import path from "node:path";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "./firebase-admin";
import { buildAngelCourtInboxQuery, scanAngelCourtAttachments, type AngelCourtInboxAttachment } from "./angel-court-inbox";
import { fetchGmailXlsxAttachments, readGmailOAuthFiles, refreshGmailAccessToken } from "./gmail-client";

const STATE_ID = "gmail";

function configuredPath(value: string | undefined, fallback: string) {
  return path.resolve(value || fallback);
}

export function londonScanWindow(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(now);
  const weekday = parts.find((part) => part.type === "weekday")?.value;
  const hour = Number(parts.find((part) => part.type === "hour")?.value || 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value || 0);
  return weekday !== "Sat" && weekday !== "Sun" && (hour * 60 + minute) >= 7 * 60 && (hour * 60 + minute) <= 17 * 60;
}

export function londonScanSlot(now = new Date()) {
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(now);
  const hour = Number(parts.find((part) => part.type === "hour")?.value || 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value || 0);
  return `${date}T${String(hour).padStart(2, "0")}:${String(Math.floor(minute / 15) * 15).padStart(2, "0")}`;
}

export type AngelCourtGmailScanResult = { runId: string; query: string; attachments: number; imported: number; skipped: number; lastScanAt: string; state: "succeeded" | "failed" };

export async function runAngelCourtGmailScan(options: { force?: boolean; now?: Date } = {}): Promise<AngelCourtGmailScanResult> {
  const now = options.now || new Date();
  const stateRef = db.collection("angelCourtInboxState").doc(STATE_ID);
  const previous = await stateRef.get();
  const lastScanAt = previous.exists ? String(previous.get("lastScanAt") || "") : "";
  const startedAt = now.toISOString();
  const clientPath = configuredPath(process.env.GMAIL_OAUTH_CLIENT_FILE, path.join(process.cwd(), "..", "..", "secrets", "gmail-oauth-client.json"));
  const tokenPath = configuredPath(process.env.GMAIL_OAUTH_TOKEN_FILE, path.join(process.cwd(), "..", "..", "secrets", "gmail-token.json"));
  try {
    const { client, token } = await readGmailOAuthFiles(clientPath, tokenPath);
    const accessToken = await refreshGmailAccessToken(client, token);
    const query = process.env.ANGEL_COURT_GMAIL_QUERY || buildAngelCourtInboxQuery({ earliestScanDate: process.env.ANGEL_COURT_EARLIEST_SCAN_DATE, lastScanAt });
    const maxMessages = Math.max(1, Number(process.env.ANGEL_COURT_GMAIL_MAX_MESSAGES || 100));
    const allAttachments = await fetchGmailXlsxAttachments(accessToken, query, maxMessages);
    // A forced scan runs immediately, but it still honours the checkpoint so
    // the same message is never re-imported merely because a user clicked it.
    const attachments = lastScanAt
      ? allAttachments.filter((attachment) => !attachment.receivedAt || attachment.receivedAt > lastScanAt)
      : allAttachments;
    const existing = await db.collection("angelCourtInboxCandidates").select("sourceKey").get();
    const processed = new Set(existing.docs.map((doc) => String(doc.get("sourceKey"))));
    const result = scanAngelCourtAttachments(attachments as AngelCourtInboxAttachment[], processed);
    const run = await db.collection("angelCourtInboxRuns").add({ mode: "gmail-local", query, adapterVersion: "fika.angel-court-inbox-adapter.v1", sourceCount: attachments.length, importedCount: result.candidates.length, skippedCount: result.skipped.length, canonicalWrite: "disabled", startedAt, createdAt: FieldValue.serverTimestamp() });
    const batch = db.batch();
    for (const candidate of result.candidates) {
      const id = candidate.sourceKey.replace(/[^A-Za-z0-9_-]/g, "_");
      batch.set(db.collection("angelCourtInboxCandidates").doc(id), { sourceKey: candidate.sourceKey, runId: run.id, reviewState: candidate.warnings.length ? "needs_review" : "ready_for_review", canonicalWrite: "disabled", candidate, updatedAt: FieldValue.serverTimestamp() });
    }
    await batch.commit();
    const completedAt = new Date().toISOString();
    await stateRef.set({ source: "gmail", lastScanAt: completedAt, lastSuccessfulScanAt: completedAt, lastAttemptAt: startedAt, status: "succeeded", runId: run.id, query, imported: result.candidates.length, skipped: result.skipped.length, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return { runId: run.id, query, attachments: attachments.length, imported: result.candidates.length, skipped: result.skipped.length, lastScanAt: completedAt, state: "succeeded" };
  } catch (error) {
    await stateRef.set({ source: "gmail", lastAttemptAt: startedAt, status: "failed", error: error instanceof Error ? error.message : String(error), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    throw error;
  }
}

export async function getAngelCourtGmailScanState() {
  const snapshot = await db.collection("angelCourtInboxState").doc(STATE_ID).get();
  return snapshot.exists ? snapshot.data() : { source: "gmail", status: "never_run" };
}
