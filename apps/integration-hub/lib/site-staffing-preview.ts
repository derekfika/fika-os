export type StaffingSourceEmployee = { team: string; name: string; role?: string | null; page?: number };
export type PreviewCanonical = { canonicalId: string; entityType: string; lifecycleStatus?: string; publicationStatus?: string; record: Record<string, unknown> };

export type StaffingPreviewRow = {
  sourceTeam: string;
  sourceName: string;
  sourceRole: string;
  legendName?: string;
  legendId?: string;
  oplocName?: string;
  oplocId?: string;
  staffingRoleName?: string;
  staffingRoleId?: string;
  existingAssignmentId?: string;
  proposedAction: "create" | "no-change" | "review" | "exclude";
  confidence: "high" | "medium" | "low";
  reviewReason?: string;
  sourceEvidence: string;
};

const TEAM_ALIASES: Record<string, string> = {
  "angel court": "one angel court",
  fikax: "fika xchange",
  "munich re": "munich re",
};

const ROLE_ALIASES: Record<string, string> = {
  barista: "Barista",
  "head barista": "Coffee Specialist",
  "senior barista": "Coffee Specialist",
  "coffee specialist": "Coffee Specialist",
  "coffee specialist trainer": "Coffee Specialist",
  "general manager": "Catering Manager",
  "deputy manager": "Deputy Manager",
  "deputy general manager": "Deputy Manager",
  "assistant general manager": "Deputy Manager",
  "kitchen porter": "Kitchen Porter",
  kp: "Kitchen Porter",
  "general assistant": "Hospitality Assistant",
  "catering assistant": "Hospitality Assistant",
  "hospitality assistant": "Hospitality Assistant",
};

export function normaliseStaffingLabel(value: string) {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function canonicalStaffingRoleName(sourceRole: string) {
  const compact = sourceRole.replace(/\s+/g, " ").trim();
  const normalised = normaliseStaffingLabel(compact);
  if (normalised === "chef") return "Chef";
  if (normalised === "cdp" || normalised === "chef de partie") return "Chef de Partie";
  return compact;
}

export function proposedStaffingRole(sourceRole: string, roles: PreviewCanonical[]) {
  const requested = ROLE_ALIASES[normaliseStaffingLabel(sourceRole)] || canonicalStaffingRoleName(sourceRole);
  if (!requested) return undefined;
  return roles.find(role => role.record.active !== false && normaliseStaffingLabel(String(role.record.name || "")) === normaliseStaffingLabel(requested));
}

function activeLegend(record: PreviewCanonical) {
  return record.entityType === "Legend" && record.record.active !== false && !/terminated|inactive|left|leaver/i.test(String(record.record.employmentState || ""));
}

function activeOploc(record: PreviewCanonical) {
  return record.entityType === "OPLOC" && record.record.active !== false && record.record.lifecycleState === "active";
}

function oplocLabels(record: PreviewCanonical) {
  const aliases = Array.isArray(record.record.aliases) ? record.record.aliases : [];
  return [String(record.record.approvedName || ""), ...aliases.flatMap(alias => alias && typeof alias === "object" ? [String((alias as Record<string, unknown>).alias || "")] : [])].map(normaliseStaffingLabel);
}

export function buildSiteStaffingPreview(source: StaffingSourceEmployee[], canonical: PreviewCanonical[]): StaffingPreviewRow[] {
  const legends = canonical.filter(activeLegend);
  const oplocs = canonical.filter(activeOploc);
  const roles = canonical.filter(record => record.entityType === "Staffing Role" && record.record.active !== false);
  const assignments = canonical.filter(record => record.entityType === "Site Role Assignment" && record.record.active !== false && record.record.lifecycleState === "active");
  const sourceTeamsByLegend = new Map<string, Set<string>>();
  for (const employee of source) {
    const key = normaliseStaffingLabel(employee.name);
    const teams = sourceTeamsByLegend.get(key) || new Set<string>();
    teams.add(normaliseStaffingLabel(employee.team));
    sourceTeamsByLegend.set(key, teams);
  }

  return source.map(employee => {
    const sourceEvidence = `BrightHR Employee Hub PDF${employee.page ? ` page ${employee.page}` : ""}`;
    const base = { sourceTeam: employee.team, sourceName: employee.name, sourceRole: employee.role || "Not supplied", sourceEvidence };
    if ((sourceTeamsByLegend.get(normaliseStaffingLabel(employee.name))?.size || 0) > 1) return { ...base, proposedAction: "exclude", confidence: "high", reviewReason: "This Legend appears in more than one BrightHR team and requires multi-site review." };
    if (normaliseStaffingLabel(employee.team) === "central") return { ...base, proposedAction: "exclude", confidence: "high", reviewReason: "Central/operations team requires separate review." };
    if (/relief|agency|support|cover/i.test(employee.role || "")) return { ...base, proposedAction: "exclude", confidence: "high", reviewReason: "Relief, support or cover role is not permanent home-OPLOC evidence." };

    const legendMatches = legends.filter(record => normaliseStaffingLabel(String(record.record.displayName || "")) === normaliseStaffingLabel(employee.name));
    if (legendMatches.length !== 1) return { ...base, proposedAction: "review", confidence: "low", reviewReason: legendMatches.length ? "More than one active Legend has this normalised name." : "No active Legend matched this source name exactly." };
    const legend = legendMatches[0];

    const sourceTeam = normaliseStaffingLabel(employee.team);
    const targetTeam = TEAM_ALIASES[sourceTeam] || sourceTeam;
    const oplocMatches = oplocs.filter(record => oplocLabels(record).includes(targetTeam));
    if (oplocMatches.length !== 1) return { ...base, legendName: String(legend.record.displayName), legendId: legend.canonicalId, proposedAction: "review", confidence: "low", reviewReason: oplocMatches.length ? "More than one active OPLOC matched this team." : "No active OPLOC matched this BrightHR team." };
    const oploc = oplocMatches[0];

    const role = employee.role ? proposedStaffingRole(employee.role, roles) : undefined;
    if (!role) return { ...base, legendName: String(legend.record.displayName), legendId: legend.canonicalId, oplocName: String(oploc.record.approvedName), oplocId: oploc.canonicalId, proposedAction: "review", confidence: "medium", reviewReason: employee.role ? "The BrightHR job title does not map unambiguously to the current staffing-role catalogue." : "BrightHR does not display a job title for this Legend." };

    const exact = assignments.find(assignment => assignment.record.legendId === legend.canonicalId && assignment.record.oplocId === oploc.canonicalId && assignment.record.staffingRoleId === role.canonicalId);
    const conflicting = assignments.find(assignment => assignment.record.legendId === legend.canonicalId && (assignment.record.oplocId !== oploc.canonicalId || assignment.record.staffingRoleId !== role.canonicalId));
    if (exact) return { ...base, legendName: String(legend.record.displayName), legendId: legend.canonicalId, oplocName: String(oploc.record.approvedName), oplocId: oploc.canonicalId, staffingRoleName: String(role.record.name), staffingRoleId: role.canonicalId, existingAssignmentId: exact.canonicalId, proposedAction: "no-change", confidence: "high" };
    if (conflicting) return { ...base, legendName: String(legend.record.displayName), legendId: legend.canonicalId, oplocName: String(oploc.record.approvedName), oplocId: oploc.canonicalId, staffingRoleName: String(role.record.name), staffingRoleId: role.canonicalId, existingAssignmentId: conflicting.canonicalId, proposedAction: "review", confidence: "medium", reviewReason: "An active assignment exists with a different OPLOC or staffing role." };
    return { ...base, legendName: String(legend.record.displayName), legendId: legend.canonicalId, oplocName: String(oploc.record.approvedName), oplocId: oploc.canonicalId, staffingRoleName: String(role.record.name), staffingRoleId: role.canonicalId, proposedAction: "create", confidence: "high" };
  });
}
