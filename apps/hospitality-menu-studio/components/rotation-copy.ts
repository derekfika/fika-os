/** Select a different source whenever the destination changes. */
export function rotationSource(source: number, destination: number): number {
  if (
    Number.isInteger(source) &&
    source >= 0 &&
    source < 6 &&
    source !== destination
  )
    return source;
  return destination > 0 ? destination - 1 : 1;
}

/** Return a new destination only when replacement is explicitly authorised. */
export function copyRotationChoices(
  weeks: string[][],
  source: number,
  destination: number,
  confirmed: boolean,
): string[] | null {
  if (
    !Number.isInteger(source) ||
    !Number.isInteger(destination) ||
    source < 0 ||
    source >= 6 ||
    destination < 0 ||
    destination >= 6 ||
    source === destination
  )
    return null;
  if ((weeks[destination]?.length || 0) > 0 && !confirmed) return null;
  return [...(weeks[source] || [])];
}
