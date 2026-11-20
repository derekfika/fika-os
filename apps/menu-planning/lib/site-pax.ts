export type MenuSiteKind = "governed" | "one-off";
export type SitePax = Record<string, number>;
export type SitePaxUpdate = { dayId: string; kind: MenuSiteKind; destinationId: string; pax: number | null };

export const menuSiteKey = (kind: MenuSiteKind, destinationId: string) => `${kind}:${destinationId}`;
export function menuSiteIdentity(key: string): { kind: MenuSiteKind; id: string } | undefined {
  const separator = key.indexOf(":");
  const kind = key.slice(0, separator);
  const id = key.slice(separator + 1);
  return (kind === "governed" || kind === "one-off") && id ? { kind, id } : undefined;
}

export function parsePaxInput(raw: string): number | null | undefined {
  const value = raw.trim();
  if (!value) return null;
  if (!/^\d+$/.test(value)) return undefined;
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : undefined;
}
