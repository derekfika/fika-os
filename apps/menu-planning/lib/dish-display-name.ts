/** Remove the legacy import marker from labels without changing stored catalogue identity or names. */
export function dishDisplayName(name: string): string {
  return name.replace(/^Menu-Item:\s*/i, "");
}

/** Number of source characters omitted from the user-facing label. */
export function dishDisplayNameOffset(sourceName: string): number {
  return sourceName.length - dishDisplayName(sourceName).length;
}
