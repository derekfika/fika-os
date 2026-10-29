import { gunzipSync } from "fflate";
import nspell from "nspell";
import type { SpellerLike } from "../menu-spellcheck";

/**
 * Versioned en_GB dictionary package. Built by scripts/build-en-gb-dictionary.mjs: gzip of a JSON document holding the Hunspell
 * affix and dictionary files, the FIKA culinary word list and the licence text. The sha256 of the gzip bytes is checked before anything
 * is decompressed, so a corrupt or partial download can never reach the speller.
 */
export const EN_GB_FORMAT = "fika.en-gb-hunspell.v1";
/** Upper bound on decompressed size. The current package is about 0.6 MB; anything far larger is treated as corrupt. */
export const MAX_UNCOMPRESSED_BYTES = 4 * 1024 * 1024;

export type EnGbPayload = {
  format: typeof EN_GB_FORMAT;
  version: string;
  files: { aff: string; dic: string; culinary: string };
  licence: string;
};

export type DictionaryMeta = { version: string; sha256: string; byteLength: number };

export class DictionaryIntegrityError extends Error {}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new DictionaryIntegrityError("Web Crypto is unavailable, so the dictionary cannot be verified.");
  const digest = new Uint8Array(await subtle.digest("SHA-256", bytes as BufferSource));
  return Array.from(digest, byte => byte.toString(16).padStart(2, "0")).join("");
}

/** Verifies the compressed bytes against the expected checksum and size before decompression. */
export async function verifyPackageBytes(bytes: Uint8Array, meta: DictionaryMeta) {
  if (bytes.byteLength !== meta.byteLength) throw new DictionaryIntegrityError("Dictionary download is incomplete.");
  if (await sha256Hex(bytes) !== meta.sha256) throw new DictionaryIntegrityError("Dictionary checksum does not match.");
}

/** Decompresses and validates the payload shape. Throws DictionaryIntegrityError on any mismatch. */
export function decodeEnGbPayload(bytes: Uint8Array, expectedVersion: string): EnGbPayload {
  let text: string;
  try {
    const raw = gunzipSync(bytes);
    if (raw.byteLength > MAX_UNCOMPRESSED_BYTES) throw new DictionaryIntegrityError("Dictionary is larger than expected.");
    text = new TextDecoder("utf-8", { fatal: true }).decode(raw);
  } catch (error) {
    if (error instanceof DictionaryIntegrityError) throw error;
    throw new DictionaryIntegrityError("Dictionary could not be decompressed.");
  }
  let payload: Partial<EnGbPayload>;
  try {
    payload = JSON.parse(text) as Partial<EnGbPayload>;
  } catch {
    throw new DictionaryIntegrityError("Dictionary payload is not valid JSON.");
  }
  const files = payload.files;
  const valid = payload.format === EN_GB_FORMAT && payload.version === expectedVersion && typeof files?.aff === "string" && typeof files.dic === "string"
    && typeof files.culinary === "string" && files.aff.length > 0 && files.dic.length > 0 && typeof payload.licence === "string" && payload.licence.length > 0;
  if (!valid) throw new DictionaryIntegrityError("Dictionary payload does not match this version.");
  return payload as EnGbPayload;
}

/** Builds the speller from a decoded payload. Culinary vocabulary is added on top of the general en_GB word list. */
export function createEnGbSpeller(payload: EnGbPayload): SpellerLike {
  const speller = nspell({ aff: payload.files.aff, dic: payload.files.dic });
  for (const word of payload.files.culinary.split("\n")) {
    const trimmed = word.trim();
    if (trimmed && !trimmed.startsWith("#")) speller.add(trimmed);
  }
  return speller;
}
