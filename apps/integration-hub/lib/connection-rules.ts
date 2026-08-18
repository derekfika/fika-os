import type { CanonicalEditorInput } from "./canonical-editor";
import type { CanonicalRecord } from "./types";

export function validateOperationalAssignmentConnection(input: {
  command: CanonicalEditorInput;
  current: CanonicalRecord | null;
  legend: CanonicalRecord;
  employments: CanonicalRecord[];
  assignments: CanonicalRecord[];
}) {
  if (input.command.entityType !== "Operational Assignment") return;
  const values = input.command.values;
  if (!input.current && isTerminatedLegend(input.legend, input.employments))
    throw conflict(
      "This Legend is terminated and cannot receive a new working-location assignment. Their existing history remains available.",
    );

  const candidate = {
    legendId: String(values.legendId || ""),
    oplocId: String(values.oplocId || ""),
    role: normaliseRole(values.assignmentRole),
    designation: String(values.designation || ""),
    from: String(values.effectiveFrom || ""),
    until: optionalDate(values.effectiveTo),
    active: String(values.lifecycleState || "active") === "active",
  };
  if (!candidate.active) return;

  for (const assignment of input.assignments) {
    if (
      assignment.canonicalId === input.current?.canonicalId ||
      assignment.lifecycleStatus === "archived" ||
      String(assignment.record.lifecycleState || "active") !== "active"
    )
      continue;
    if (String(assignment.record.legendId || "") !== candidate.legendId)
      continue;
    const overlaps = rangesOverlap(
      candidate.from,
      candidate.until,
      String(assignment.record.effectiveFrom || ""),
      optionalDate(assignment.record.effectiveTo),
    );
    if (!overlaps) continue;
    if (
      String(assignment.record.oplocId || "") === candidate.oplocId &&
      normaliseRole(assignment.record.assignmentRole) === candidate.role
    )
      throw conflict(
        "This Legend already has an overlapping active assignment for the same location and role. Edit the existing assignment instead.",
      );
    if (
      candidate.designation === "primary" &&
      String(assignment.record.designation || "") === "primary"
    )
      throw conflict(
        "This Legend already has an overlapping primary working location. End or change the existing primary assignment first.",
      );
  }
}

export function isTerminatedLegend(
  legend: CanonicalRecord,
  employments: CanonicalRecord[],
) {
  const history = employments.filter(
    (record) =>
      record.entityType === "Employment" &&
      record.lifecycleStatus !== "archived" &&
      String(record.record.legendId || "") === legend.canonicalId,
  );
  if (history.length)
    return !history.some(
      (record) =>
        activeEmploymentState(record.record.employmentState) &&
        !record.record.terminationDate,
    );
  return (
    legend.record.active === false ||
    !activeEmploymentState(legend.record.employmentState)
  );
}

export function roleAssignmentDoesNotGrantPermissions() {
  return true;
}

function activeEmploymentState(value: unknown) {
  const state = String(value || "").trim().toLowerCase();
  return !state || !["terminated", "ended", "inactive", "left"].includes(state);
}

function rangesOverlap(
  leftFrom: string,
  leftUntil: string | undefined,
  rightFrom: string,
  rightUntil: string | undefined,
) {
  const leftEnd = leftUntil || "9999-12-31";
  const rightEnd = rightUntil || "9999-12-31";
  return leftFrom <= rightEnd && rightFrom <= leftEnd;
}

function normaliseRole(value: unknown) {
  return String(value || "").trim().toLocaleLowerCase();
}

function optionalDate(value: unknown) {
  const date = String(value || "").trim();
  return date || undefined;
}

function conflict(message: string) {
  return Object.assign(new Error(message), { status: 409 });
}
