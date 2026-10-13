/**
 * Marks projections / packages that were BUILT with reuse authority bindings. It lives in its own dependency-free module so the
 * server builders, the response-time revalidation and the browser cache consumers all share one definition. A projection without it
 * (a historical package) may contain reused entries that cannot be told apart: it is never trusted from a cache.
 */
export const PROJECTION_AUTHORITY_BINDING_VERSION = 1;
export const isAuthorityBound = (value: { authorityBindingVersion?: number } | undefined | null) => value?.authorityBindingVersion === PROJECTION_AUTHORITY_BINDING_VERSION;
