// Development dashboard owner marks (#241). Browser-safe: types, labels and pure reconciliation only (no node:crypto, no Firestore).
// Marks are OWNER-RECORDED ASSERTIONS. They live beside, and never inside, the verified GitHub / release evidence.
import type { IssueView, StepKey, StepStatus } from "./types";

export const MARK_KINDS = ["checked", "uat-accepted", "uat-failed", "deployed-staging", "pushed-to-production", "blocked-note", "clear"] as const;
export type MarkKind = (typeof MARK_KINDS)[number];
export const MARK_SLOTS = ["checked", "uat", "staging", "production", "blocked"] as const;
export type MarkSlot = (typeof MARK_SLOTS)[number];

export const SLOT_OF: Record<Exclude<MarkKind, "clear">, MarkSlot> = {
  checked: "checked", "uat-accepted": "uat", "uat-failed": "uat", "deployed-staging": "staging", "pushed-to-production": "production", "blocked-note": "blocked",
};
export const KIND_LABEL: Record<MarkKind, string> = {
  checked: "Checked by owner", "uat-accepted": "UAT accepted by owner", "uat-failed": "UAT failed (owner)", "deployed-staging": "Deployed to staging (owner says)",
  "pushed-to-production": "Pushed to production (owner says)", "blocked-note": "Blocked note (owner)", clear: "Mark cleared",
};
export const SLOT_LABEL: Record<MarkSlot, string> = { checked: "Checked", uat: "UAT", staging: "Staging", production: "Production", blocked: "Blocked note" };

export const NOTE_MAX = 300;
export const SHA_PATTERN = /^[0-9a-f]{40}$/;

/** One current owner-recorded assertion in a slot. */
export interface MarkEntry { kind: Exclude<MarkKind, "clear">; boundSha?: string; shaVerified?: boolean; note?: string; actorId: string; actorName: string; at: string; eventId: string }
/** Derived current state for one issue. `version` is the optimistic-concurrency token (0 = never marked). */
export interface IssueMarks { issueNumber: number; version: number; slots: Partial<Record<MarkSlot, MarkEntry>>; updatedAt?: string }
/** Append-only history record: authoritative evidence of one owner action. */
export interface MarkEvent {
  eventId: string; issueNumber: number; version: number; previousVersion: number; kind: MarkKind; slot: MarkSlot; boundSha?: string; shaVerified?: boolean; note?: string;
  actorId: string; actorName: string; at: string; idempotencyKey: string; payloadHash: string; source: "development-dashboard"; ownerRecorded: true;
}
/** What the snapshot carries to the browser. `available:false` means the marks store could not be read (never "no marks"). */
export interface MarksView { available: boolean; reason?: string; byIssue: Record<string, IssueMarks> }

const sha7 = (sha?: string) => (sha || "").slice(0, 7);

export interface StepOwnerNote { stepKey: StepKey; entry: MarkEntry; verifiedText: string; ownerText: string; differs: boolean; warning?: string }
const STEP_STATUS_TEXT: Record<StepStatus, string> = { evidenced: "Evidenced", pending: "Pending", failed: "Failed", not_reached: "Not reached", not_connected: "Not connected" };
const SLOT_STEP: Partial<Record<MarkSlot, StepKey>> = { staging: "staging", uat: "uat", production: "production" };

/** The SHA that the verified lifecycle says staging is serving, if (and only if) it is evidenced. */
export function verifiedStagingSha(issue: IssueView): string | undefined {
  const staging = issue.steps.find(s => s.key === "staging");
  return staging?.status === "evidenced" ? staging.evidence?.sha : undefined;
}

/**
 * Side-by-side verified vs owner-recorded for the lifecycle steps an owner can assert. The owner mark never changes the verified step;
 * `differs` is true whenever the verified evidence does not corroborate the assertion.
 */
export function reconcileOwnerMarks(issue: IssueView, marks?: IssueMarks): StepOwnerNote[] {
  if (!marks) return [];
  const notes: StepOwnerNote[] = [];
  for (const slot of ["staging", "uat", "production"] as const) {
    const entry = marks.slots[slot]; const stepKey = SLOT_STEP[slot]!; const step = issue.steps.find(s => s.key === stepKey);
    if (!entry || !step) continue;
    const corroborated = entry.kind === "uat-failed" ? step.status === "failed" : step.status === "evidenced";
    let warning: string | undefined;
    if (slot === "uat" && entry.boundSha) {
      const serving = verifiedStagingSha(issue);
      if (serving && serving !== entry.boundSha) warning = `Recorded against build ${sha7(entry.boundSha)}; staging now serves ${sha7(serving)}. Re-test before relying on it.`;
      else if (!entry.shaVerified) warning = `Build ${sha7(entry.boundSha)} was typed by the owner and is unverified.`;
    }
    notes.push({ stepKey, entry, verifiedText: STEP_STATUS_TEXT[step.status], ownerText: KIND_LABEL[entry.kind], differs: !corroborated, ...(warning ? { warning } : {}) });
  }
  return notes;
}

/**
 * "My actions" hides what the owner has already dealt with, but only while the mark is still current:
 * a `checked` mark lapses when the issue changes afterwards, and `uat-accepted` lapses when staging serves a different build.
 * Hiding never alters the verified state, which stays visible in the "Marked by you" disclosure.
 */
export function ownerHandled(issue: IssueView, marks?: IssueMarks): boolean {
  if (!marks) return false;
  const checked = marks.slots.checked;
  if (checked && checked.at >= issue.updatedAt) return true;
  const uat = marks.slots.uat;
  if (uat?.kind === "uat-accepted") {
    const serving = verifiedStagingSha(issue);
    if (serving ? uat.boundSha === serving : uat.at >= issue.updatedAt) return true;
  }
  return false;
}
