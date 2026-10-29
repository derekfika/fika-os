import meta from "../../dictionary/en-GB-3.0.0-culinary-1.meta.json";
import { createEnGbSpeller, decodeEnGbPayload, verifyPackageBytes } from "./en-gb-payload";
import type { SpellerLike } from "../menu-spellcheck";

export const DICTIONARY_URL = `/api/spellcheck/dictionary?version=${encodeURIComponent(meta.version)}`;

/** One verified dictionary per page, shared by every cell and the suggestions panel. */
export function createDictionaryLoader(fetcher: typeof fetch = fetch) {
  let pending: Promise<SpellerLike> | undefined;
  return (retry = false): Promise<SpellerLike> => {
    if (!pending) pending = (async () => {
      const response = await fetcher(DICTIONARY_URL, { cache: retry ? "reload" : "force-cache" });
      if (!response.ok) throw Error("The UK spelling dictionary could not be loaded.");
      const bytes = new Uint8Array(await response.arrayBuffer());
      await verifyPackageBytes(bytes, meta);
      return createEnGbSpeller(decodeEnGbPayload(bytes, meta.version));
    })().catch(error => { pending = undefined; throw error; });
    return pending;
  };
}

export const loadEnGbSpeller = createDictionaryLoader();
