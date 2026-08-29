import type { UsageResolution } from "./usage-observatory";

export function chartTickIndexes(length: number, resolution: UsageResolution): number[] {
  if (length <= 1) return [0];
  const maximumLabels = { "1m": 3, "5m": 4, "1h": 5, "1d": 7 }[resolution];
  const count = Math.min(length, maximumLabels);
  return Array.from({ length: count }, (_, index) => Math.round(index * (length - 1) / (count - 1)));
}
