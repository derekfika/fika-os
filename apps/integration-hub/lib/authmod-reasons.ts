export const ROUTINE_ACCESS_REASONS = [
  { code: "role_requirement", label: "Role requirement" },
  { code: "new_starter", label: "New starter" },
  { code: "site_responsibility", label: "Site responsibility" },
  { code: "temporary_cover", label: "Temporary cover" },
  { code: "access_correction", label: "Access correction" },
  { code: "operational_requirement", label: "Operational requirement" },
  { code: "other", label: "Other" },
] as const;

export type AuthmodReasonCode = (typeof ROUTINE_ACCESS_REASONS)[number]["code"];

const labels = new Map<string, string>(ROUTINE_ACCESS_REASONS.map(reason => [reason.code, reason.label]));

export function resolveAuthmodReason(input: { action: string; reason?: string; reasonCode?: string; reasonNote?: string }) {
  const note = input.reasonNote?.trim() || "";
  const code = input.reasonCode?.trim() || "";
  const routine = input.action === "site" || input.action === "app" || input.action === "legend";

  if (code) {
    const label = labels.get(code);
    if (!label) throw Object.assign(new Error("Choose a valid AUTHMOD access-change reason."), { status: 422, code: "AUTHMOD_REASON_CODE_INVALID" });
    if (code === "other" && note.length < 3) throw Object.assign(new Error("Other access changes require a short explanation."), { status: 422, code: "AUTHMOD_REASON_NOTE_REQUIRED" });
    if (!routine && note.length < 3) throw Object.assign(new Error("Sensitive AUTHMOD changes require a specific explanation."), { status: 422, code: "AUTHMOD_REASON_NOTE_REQUIRED" });
    return `${label}${note ? ` — ${note}` : ""}`;
  }

  const freeText = input.reason?.trim() || "";
  if (freeText.length < 3) {
    throw Object.assign(new Error(routine ? "Choose a reason for this access change." : "Enter a specific administrative reason before confirming."), { status: 422, code: "AUTHMOD_REASON_REQUIRED" });
  }
  return freeText;
}
