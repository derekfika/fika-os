import { mayAutoRefreshDashboard } from "../../shared/passive-dashboard-refresh";

export const PASSIVE_REFRESH_INTERVAL_MS = 15 * 60_000;

export type PassiveRefreshGate = {
  now: number;
  lastAttemptAt?: number;
  visible: boolean;
  requestsBlocked: boolean;
  inFlight: boolean;
};

export function mayRequestPassiveRefresh({ now, lastAttemptAt, visible, requestsBlocked, inFlight }: PassiveRefreshGate) {
  return mayAutoRefreshDashboard({ now, lastAttemptAt, visible, requestsBlocked, inFlight, minimumIntervalMs: PASSIVE_REFRESH_INTERVAL_MS });
}
