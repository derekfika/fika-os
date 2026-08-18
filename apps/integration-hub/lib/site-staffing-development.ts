import { isTerminatedLegend } from "./connection-rules";
import type { CanonicalRecord } from "./types";

export type StaffingRequirementValues = {
  oplocId: string;
  staffingRoleId: string;
  requiredHeadcount: number;
  effectiveFrom: string;
  effectiveTo?: string;
  notes?: string;
};
export type SiteRoleAssignmentValues = {
  legendId: string;
  oplocId: string;
  staffingRoleId: string;
  effectiveFrom: string;
  effectiveTo?: string;
  primaryLocation: boolean;
  lifecycleState: "active" | "ended";
};

export function validateStaffingRequirement(input: {
  values: StaffingRequirementValues;
  currentId?: string;
  oplocs: CanonicalRecord[];
  roles: CanonicalRecord[];
  requirements: CanonicalRecord[];
}) {
  if (!Number.isInteger(input.values.requiredHeadcount) || input.values.requiredHeadcount < 1)
    throw invalid("Required headcount must be a positive whole number.");
  assertReference(input.oplocs, input.values.oplocId, "OPLOC");
  const role = assertReference(
    input.roles,
    input.values.staffingRoleId,
    "Staffing Role",
  );
  const current = input.requirements.find(
    (requirement) => requirement.canonicalId === input.currentId,
  );
  if (
    role.record.active === false &&
    (!current ||
      String(current.record.staffingRoleId || "") !==
        input.values.staffingRoleId)
  )
    throw invalid("An inactive Staffing Role cannot receive a new requirement.");
  for (const requirement of input.requirements) {
    if (
      requirement.canonicalId === input.currentId ||
      requirement.lifecycleStatus === "archived" ||
      String(requirement.record.oplocId || "") !== input.values.oplocId ||
      String(requirement.record.staffingRoleId || "") !== input.values.staffingRoleId
    )
      continue;
    if (
      rangesOverlap(
        input.values.effectiveFrom,
        input.values.effectiveTo,
        String(requirement.record.effectiveFrom || ""),
        optionalDate(requirement.record.effectiveTo),
      )
    )
      throw invalid(
        "This OPLOC already has an overlapping staffing requirement for the selected role. Edit the existing requirement instead.",
      );
  }
}

export function validateSiteRoleAssignment(input: {
  values: SiteRoleAssignmentValues;
  currentId?: string;
  legends: CanonicalRecord[];
  employments: CanonicalRecord[];
  oplocs: CanonicalRecord[];
  roles: CanonicalRecord[];
  assignments: CanonicalRecord[];
  requirements: CanonicalRecord[];
}) {
  const legend = assertReference(input.legends, input.values.legendId, "Legend");
  assertReference(input.oplocs, input.values.oplocId, "OPLOC");
  const role = assertReference(
    input.roles,
    input.values.staffingRoleId,
    "Staffing Role",
  );
  const current = input.assignments.find(
    (assignment) => assignment.canonicalId === input.currentId,
  );
  if (
    isTerminatedLegend(legend, input.employments) &&
    (!current || String(current.record.legendId || "") !== input.values.legendId)
  )
    throw invalid(
      "This Legend is terminated and cannot receive a new site-role assignment. Existing history remains available.",
    );
  if (
    role.record.active === false &&
    (!current ||
      String(current.record.staffingRoleId || "") !==
        input.values.staffingRoleId)
  )
    throw invalid("An inactive Staffing Role cannot receive a new assignment.");

  if (input.values.lifecycleState === "active") {
    for (const assignment of input.assignments) {
      if (
        assignment.canonicalId === input.currentId ||
        assignment.lifecycleStatus === "archived" ||
        String(assignment.record.lifecycleState || "active") !== "active" ||
        String(assignment.record.legendId || "") !== input.values.legendId ||
        !rangesOverlap(
          input.values.effectiveFrom,
          input.values.effectiveTo,
          String(assignment.record.effectiveFrom || ""),
          optionalDate(assignment.record.effectiveTo),
        )
      )
        continue;
      if (
        String(assignment.record.oplocId || "") === input.values.oplocId &&
        String(assignment.record.staffingRoleId || "") ===
          input.values.staffingRoleId
      )
        throw invalid(
          "This Legend already has an overlapping assignment for the same OPLOC and Staffing Role.",
        );
      if (
        input.values.primaryLocation &&
        assignment.record.primaryLocation === true
      )
        throw invalid(
          "This Legend already has an overlapping active primary location. End or update the existing primary assignment first.",
        );
    }
  }

  const hasRequirement = input.requirements.some(
    (requirement) =>
      requirement.lifecycleStatus !== "archived" &&
      String(requirement.record.oplocId || "") === input.values.oplocId &&
      String(requirement.record.staffingRoleId || "") ===
        input.values.staffingRoleId &&
      rangesOverlap(
        input.values.effectiveFrom,
        input.values.effectiveTo,
        String(requirement.record.effectiveFrom || ""),
        optionalDate(requirement.record.effectiveTo),
      ),
  );
  return hasRequirement
    ? []
    : [
        "No overlapping staffing requirement exists for this role. The assignment is allowed but will be shown as additional staffing.",
      ];
}

export function staffingCoverage(
  requirement: CanonicalRecord,
  assignments: CanonicalRecord[],
  onDate: string,
) {
  const qualifying = assignments.filter(
    (assignment) =>
      assignment.entityType === "Site Role Assignment" &&
      assignment.lifecycleStatus !== "archived" &&
      String(assignment.record.lifecycleState || "active") === "active" &&
      String(assignment.record.oplocId || "") ===
        String(requirement.record.oplocId || "") &&
      String(assignment.record.staffingRoleId || "") ===
        String(requirement.record.staffingRoleId || "") &&
      activeOn(assignment.record, onDate),
  );
  const required = Number(requirement.record.requiredHeadcount || 0);
  return {
    assigned: qualifying.length,
    vacancies: Math.max(required - qualifying.length, 0),
    surplus: Math.max(qualifying.length - required, 0),
    assignmentIds: qualifying.map((assignment) => assignment.canonicalId),
  };
}

export function activeOn(record: Record<string, unknown>, onDate: string) {
  const from = String(record.effectiveFrom || "");
  const until = optionalDate(record.effectiveTo);
  return Boolean(from && from <= onDate && (!until || until >= onDate));
}

function assertReference(
  records: CanonicalRecord[],
  canonicalId: string,
  entityType: string,
) {
  const record = records.find(
    (candidate) =>
      candidate.canonicalId === canonicalId &&
      candidate.entityType === entityType &&
      candidate.lifecycleStatus !== "archived",
  );
  if (!record) throw invalid(`Choose an available ${entityType}.`);
  return record;
}

function rangesOverlap(
  leftFrom: string,
  leftUntil: string | undefined,
  rightFrom: string,
  rightUntil: string | undefined,
) {
  return (
    leftFrom <= (rightUntil || "9999-12-31") &&
    rightFrom <= (leftUntil || "9999-12-31")
  );
}

function optionalDate(value: unknown) {
  const text = String(value || "").trim();
  return text || undefined;
}

function invalid(message: string) {
  return Object.assign(new Error(message), { status: 409 });
}
