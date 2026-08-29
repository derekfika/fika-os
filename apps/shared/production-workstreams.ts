/**
 * Canonical CPU Production workstreams.
 *
 * These identifiers describe operational work, not the person currently
 * assigned to it. Assignment and access are resolved separately through Hub
 * configuration and AUTHMOD.
 */
export const CPU_PRODUCTION_WORKSTREAMS = [
  "sandwiches",
  "hospitality",
  "delivered_in",
] as const;

export type CpuProductionWorkstream =
  (typeof CPU_PRODUCTION_WORKSTREAMS)[number];

export const CPU_PRODUCTION_WORKSTREAM_LABELS: Record<
  CpuProductionWorkstream,
  string
> = {
  sandwiches: "Sandwiches",
  hospitality: "Hospitality",
  delivered_in: "Delivered-In",
};

/** Isolated adapter for persisted pre-Phase-1 routing values. */
const LEGACY_WORKSTREAM_ALIASES: Record<
  string,
  CpuProductionWorkstream
> = {
  liana: "sandwiches",
  craig: "hospitality",
  site_manager: "delivered_in",
};

export function canonicalCpuProductionWorkstream(
  value: unknown,
): CpuProductionWorkstream | undefined {
  if (
    typeof value === "string" &&
    (CPU_PRODUCTION_WORKSTREAMS as readonly string[]).includes(value)
  ) {
    return value as CpuProductionWorkstream;
  }
  return typeof value === "string" ? LEGACY_WORKSTREAM_ALIASES[value] : undefined;
}

export function adaptCpuProductionWorkstreams(values: readonly unknown[]) {
  const workstreams: CpuProductionWorkstream[] = [];
  const unknown: string[] = [];
  for (const value of values) {
    const canonical = canonicalCpuProductionWorkstream(value);
    if (canonical) {
      if (!workstreams.includes(canonical)) workstreams.push(canonical);
    } else if (typeof value === "string" && value.trim()) {
      unknown.push(value);
    }
  }
  return { workstreams, unknown };
}

/** Compatibility for old dashboard URLs/query values; new navigation uses
 * the neutral dashboard names. */
export function canonicalCpuDashboardView(value: unknown) {
  if (value === "hospitality" || value === "craig") return "hospitality" as const;
  if (value === "site_manager" || value === "manager") return "site_manager" as const;
  return "production" as const;
}
