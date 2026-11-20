export const safetyLabels = {
  unverified: "Needs food-safety review",
  in_review: "Awaiting food-safety review",
  verified: "Verified",
  revoked: "Needs attention — verification revoked",
  unavailable: "Food-safety status unavailable",
} as const;

export type DishSafetyStatus = keyof typeof safetyLabels;

export function dishSafetyStatus(value: unknown): DishSafetyStatus {
  if (typeof value === "string" && Object.hasOwn(safetyLabels, value)) return value as DishSafetyStatus;
  return "unavailable";
}

export function checkerLink(origin: string | undefined, subject: unknown, dishId: string, revision: number): string | undefined {
  if (!origin || !/^http:\/\/(?:localhost|127\.0\.0\.1):[1-9][0-9]{0,4}$/.test(origin)) return undefined;
  const value = subject as { dishId?: unknown; revision?: unknown; sourceHash?: unknown } | null;
  if (!value || value.dishId !== dishId || value.revision !== revision ||
      typeof value.sourceHash !== "string" || !/^[a-f0-9]{64}$/.test(value.sourceHash)) return undefined;
  try {
    const url = new URL(origin);
    if (!url.port) return undefined;
    return new URL(`/allergens/studio/${encodeURIComponent(dishId)}/${revision}`, url.origin).toString();
  } catch {
    return undefined;
  }
}
