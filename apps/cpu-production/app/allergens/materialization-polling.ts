export const MATERIALIZATION_POLL_MAX_DURATION_MS = 2 * 60 * 1000;

const POLL_BACKOFF_MS = [2_500, 5_000, 10_000, 15_000] as const;

export function materializationPollDelay(completedPolls: number) {
  const index = Math.min(Math.max(0, Math.floor(completedPolls)), POLL_BACKOFF_MS.length - 1);
  return POLL_BACKOFF_MS[index];
}

export function materializationPollingExpired(startedAt: number, now = Date.now()) {
  return now - startedAt >= MATERIALIZATION_POLL_MAX_DURATION_MS;
}

export function materializationPollWait(completedPolls: number, startedAt: number, now = Date.now()) {
  const remaining = Math.max(0, MATERIALIZATION_POLL_MAX_DURATION_MS - (now - startedAt));
  return Math.min(materializationPollDelay(completedPolls), remaining);
}
