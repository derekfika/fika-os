/** Normalise dish/menu names for consistent display and storage. */
export function titleCase(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/(^|[\s\-/&])([a-z])/g, (_, prefix: string, letter: string) => `${prefix}${letter.toUpperCase()}`);
}
