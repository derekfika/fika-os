export function canonicalChangeReason(input: { entityType: string; operation: "created" | "updated"; label: string; note?: string }) {
  return withNote(input.entityType === "Address" ? `${input.operation === "created" ? "Created" : "Updated"} the valid Address '${input.label}' from the displayed structured information and automatically approved and published it.` : `${input.operation === "created" ? "Created" : "Updated"} the ${input.entityType} candidate '${input.label}' from the displayed structured information. Saving did not approve or publish the record.`, input.note);
}

export function addressApprovalReason(label: string, note?: string) {
  return withNote(`Approved and published the valid Address '${label}' after reviewing the displayed structured address.`, note);
}

export function lifecycleDecisionReason(label: string, from: string, to: string, note?: string) {
  return withNote(`Moved '${label}' from ${friendly(from)} to ${friendly(to)}.`, note);
}

export function sourceMappingReason(input: { status: string; sourceLabel: string; targetLabel?: string; sourceKind: string; note?: string }) {
  const base = input.status === "confirmed"
    ? `Confirmed that the ${input.sourceKind} '${input.sourceLabel}' maps to '${input.targetLabel || "the selected canonical record"}' after reviewing the displayed evidence.`
    : input.status === "rejected"
      ? `Confirmed that the ${input.sourceKind} '${input.sourceLabel}' and the displayed candidate represent different records.`
      : input.status === "deferred"
        ? `Deferred the decision for the ${input.sourceKind} '${input.sourceLabel}'.`
        : `Left the ${input.sourceKind} '${input.sourceLabel}' unresolved.`;
  return withNote(base, input.note);
}

export function completenessDecisionReason(description: string, classification: string, note?: string) {
  return withNote(`Classified '${description}' as ${friendly(classification)} after reviewing the displayed source-field information.`, note);
}

export function withNote(reason: string, note?: string) {
  const clean = String(note || "").trim();
  return clean ? `${reason} Additional note: ${clean}` : reason;
}

function friendly(value: string) { return value.replaceAll("-", " "); }
