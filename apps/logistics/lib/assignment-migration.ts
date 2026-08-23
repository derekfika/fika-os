export function resolveLegacyAssignmentServiceDate(jobDate?: string, loadDate?: string) {
  if (jobDate && loadDate && jobDate === loadDate) return { serviceDate: jobDate } as const;
  return { reason: jobDate && loadDate ? "job/load service dates conflict" : "linked job or load service date is missing" } as const;
}
