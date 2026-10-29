// Minimal typings for the pinned `nspell` package (no bundled types). Only the calls used by the dictionary loader are declared.
declare module "nspell" {
  export type NspellInstance = {
    correct(word: string): boolean;
    suggest(word: string): string[];
    add(word: string): NspellInstance;
  };
  export default function nspell(dictionary: { aff: string | Uint8Array; dic: string | Uint8Array }): NspellInstance;
}
