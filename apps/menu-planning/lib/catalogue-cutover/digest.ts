import { createHash } from "node:crypto";

/** Canonical key-sorted value. Identical algorithm to dishReferenceDigest in ../dish-reference-resolver.ts (tested for equality). */
export const ordered = (value: unknown): unknown => Array.isArray(value) ? value.map(ordered) : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered((value as Record<string, unknown>)[key])])) : value;
export const sha256 = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
/** Deterministic digest of any JSON value; names never take part in identity, only the stored value does. */
export const digest = (value: unknown) => sha256(JSON.stringify(ordered(JSON.parse(JSON.stringify(value)))));
/** Digest of an id -> digest index (the archiveDigest / mappingDigest of the #256 reference contract). */
export const indexDigest = (index: Record<string, string>) => digest(index);
