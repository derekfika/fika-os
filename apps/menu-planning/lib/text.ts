/** Preserve the user's spelling and capitalisation; native spellcheck is advisory only. */
export function normaliseDishName(value: string): string {
  return value.trim();
}

export function titleCase(value: string): string {
  return value.trim().toLocaleLowerCase("en-GB").replace(/(^|[^A-Za-zÀ-ÿ])([a-zà-ÿ])/g, (_, prefix: string, letter: string) => `${prefix}${letter.toLocaleUpperCase("en-GB")}`);
}
