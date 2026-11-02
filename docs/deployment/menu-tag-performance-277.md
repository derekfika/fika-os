# Tag registry provider — #277

Complexity: High. Recommended model: Sol. Reason: identity-scoped reference caching,
version correctness and cross-modal mutation invalidation.

`loadDishTagRegistry()` shares a registry only for a known current Menu identity and
origin. It retains data in module memory for at most 60 seconds; it never persists
tags to browser storage. Unidentified callers fetch independently. Concurrent loads
for a known identity share one request. Identity changes, mutation invalidation and
conflicts fence old in-flight responses. A lower version is rejected, never presented
as current. Failed loads remain retryable; requests have a 10-second abort deadline.

Dish Editor invalidates after a successful create-tag, and invalidates/refetches on
409. Picker adoption belongs to the non-overlapping planner workspace after this
provider is integrated. Existing category/slot/tag rules and write authority remain.

Backend registry reads still retrieve one authoritative Firestore document per GET.
Only the SDK client is reused, keyed by project; registry contents are not cached on
the server. GET responses carry `Cache-Control: no-store` and `Server-Timing` for the
registry path. Existing opt-in data-source tracing adds setup/document-get milliseconds
to console diagnostics, containing no user identity, token or registry contents.
This does not prove that SDK construction caused the reported 569–818 ms: first and
warm request timing must be measured in staging, separately from browser input work.

No new polling, Firestore listeners or read-time audit writes. Known-identity modal
reopens within TTL avoid another GET; expired/changed registries are revalidated by
fetching the canonical version. No operational mutations are used for verification.
