import { isAuthorityBound } from "../../lib/cpu-authority-binding-version";

/**
 * A cached projection may take the head-match fast path (no body fetch) only if it was built with the current reuse-authority binding.
 * A historical (pre-binding) package is identified by the missing marker: its Hospitality Planned entries are unverifiable, the server
 * downgrades them on every response, and a manifest/head that has not changed must NOT let a warm client keep showing them as Planned.
 * Entries cached before this field existed also lack it, so they are re-fetched once and then cached with it.
 */
export const isTrustedCachedProjection = (entry: { authorityBindingVersion?: number } | undefined | null) => isAuthorityBound(entry);
/** The marker to store with a freshly fetched projection (undefined for a historical package, which then stays untrusted). */
export const authorityMarkerOf = (projection: unknown) => (projection as { authorityBindingVersion?: number } | undefined)?.authorityBindingVersion;
