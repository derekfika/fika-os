/** Normalise dish/menu names for consistent display and storage. */
export function titleCase(value: string): string {
  return value.trim().toLocaleLowerCase("en-GB").replace(/(^|[^A-Za-zÀ-ÿ])([a-zà-ÿ])/g, (_, prefix: string, letter: string) => `${prefix}${letter.toLocaleUpperCase("en-GB")}`);
}
