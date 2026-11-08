/**
 * Passive dashboard refresh budget. All decisions use UK wall-clock time, including DST.
 * This does not gate initial page loads, manual refreshes, confirmed mutations,
 * live change notifications or in-progress operations.
 */
export const DASHBOARD_REFRESH_CHECK_MS = 60_000;
export const DASHBOARD_CORE_REFRESH_MS = 5 * 60_000;
export const DASHBOARD_OVERNIGHT_REFRESH_MS = 60 * 60_000;

const ukClock = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  weekday: "short",
  hour: "2-digit",
  hourCycle: "h23",
});

export type DashboardRefreshPeriod = "core" | "overnight" | "weekend";

export function dashboardRefreshPeriod(at: number | Date): DashboardRefreshPeriod {
  const parts = Object.fromEntries(ukClock.formatToParts(at).map(({ type, value }) => [type, value]));
  if (parts.weekday === "Sat" || parts.weekday === "Sun") return "weekend";
  const hour = Number(parts.hour);
  return hour >= 6 && hour < 18 ? "core" : "overnight";
}

export function dashboardPassiveRefreshIntervalMs(at: number | Date): number | null {
  const period = dashboardRefreshPeriod(at);
  return period === "weekend" ? null : period === "core" ? DASHBOARD_CORE_REFRESH_MS : DASHBOARD_OVERNIGHT_REFRESH_MS;
}

export type DashboardPassiveRefreshGate = {
  now: number;
  lastAttemptAt?: number;
  visible: boolean;
  requestsBlocked?: boolean;
  inFlight?: boolean;
  /** Keep any existing slower read-budget throttle (e.g. Logistics' 15 minutes). */
  minimumIntervalMs?: number;
};

export function mayAutoRefreshDashboard({
  now, lastAttemptAt, visible, requestsBlocked = false, inFlight = false, minimumIntervalMs = 0,
}: DashboardPassiveRefreshGate): boolean {
  if (!visible || requestsBlocked || inFlight) return false;
  const interval = dashboardPassiveRefreshIntervalMs(now);
  if (interval === null) return false;
  return lastAttemptAt === undefined || now - lastAttemptAt >= Math.max(interval, minimumIntervalMs);
}
