# Ad-Hoc Production ⇄ Integration Hub HTTP contract

Ad-Hoc Production owns only the requester's request (`fikaAdHocProductionOrdersV2`). Everything about the canonical
Production Order, its amendment and cancellation, destination authority and the Logistics requirement belongs to the
Integration Hub and is reached **only over authenticated HTTP**. Ad-Hoc imports no Hub source; the only shared code is the
dependency-free wire contract `apps/shared/ad-hoc-production-contract.ts` (types + pure helpers, no imports).

## Authentication and authorisation

Every call from the Ad-Hoc server to the Hub carries, server-side only:

| Header | Purpose |
| --- | --- |
| `cookie` (the caller's own FIKA session) | Identity and AUTHMOD scope. The Hub verifies the session and requires AUTHMOD access to the `ad-hoc-production` app (login alone is not enough). OPLOC scope is resolved by the Hub. |
| `x-fika-internal-token` (`FIKA_INTERNAL_API_TOKEN`) | Service-to-service authority for privileged order operations. Mandatory in hosted runtimes; a Hub without a configured token refuses (fail closed). Never sent to or readable by browser code. |
| `x-request-id` | Correlation. |

Ad-Hoc has no identity of its own: it never issues a synthetic actor. Local development relies on the Hub's own local-only
service identity (`localAdHocServiceAllowed`: `NODE_ENV !== production`, `FIKA_RUNTIME_MODE` unset/`local`, no Cloud Run
`K_SERVICE`/`GAE_ENV`/`FUNCTION_TARGET`), which cannot be activated in staging or production.

## Endpoints (Hub)

| Method + path | Auth | Purpose |
| --- | --- | --- |
| `GET /api/ad-hoc-production/access[?oplocs=true]` | session + AUTHMOD | Caller identity `{principal}`; with `oplocs=true` also the caller's authorised active OPLOCs and alias `redirects`. Mirrors CPU's access route. |
| `GET /api/ad-hoc-production/orders?requestId=` | session + AUTHMOD + service token | Authoritative status `{canonicalId, orderStatus, orderVersion, cancelled, allergenChecker}`; `404` if no order exists. `allergenChecker` is `{state: not_signed\|signed\|withdrawn, fileName?, driveUrl?, signedAt?, signers?, reason?}`: a PDF link is present only while CPU's signed release is current for the order's present revision (an amendment or cancellation turns it into `withdrawn`). |
| `POST /api/ad-hoc-production/orders` `{action:"send"}` | same | Create-or-amend the request's single canonical Production Order. Returns `{canonicalId, orderVersion, orderStatus, outcome: created\|amended\|already_applied, destination}`. |
| `POST /api/ad-hoc-production/orders` `{action:"cancel", requestId, reason}` | same | Governed cancellation (withdraws the Logistics requirement). `{outcome: cancelled\|already_cancelled}`; `404` if no order. |
| `POST /api/production/allergen-checker` (CPU → Hub, not called by Ad-Hoc) | CPU actor (`integration-admin`/`reviewer`, `canonical.edit`) | CPU reports `{canonicalId, state: signed\|withdrawn, releaseId, releaseVersion, sourceRevision, fileName?, driveUrl?, signedAt?, signers?, reason?}` for an Ad-Hoc order. Idempotent and monotonic by `releaseVersion`; a signed report for an already-withdrawn release is ignored. A derived projection: CPU remains the release authority. |

Request bodies are strictly validated (unknown fields rejected). Errors use the Hub's `{error:{code,message,requestId}}` shape.

## Identity, idempotency and concurrency

- One canonical order per request: `production-order:v1:ad-hoc:<requestId>`, independent of request version.
- Per-version idempotency key `adhoc-send:<requestId>:v<version>`; the Hub rejects a key/version/request mismatch.
- The Hub looks the order up by that stable identity, never by state Ad-Hoc saved, so a retry after a lost response, an edit
  between attempts or concurrent first sends converge on one order and one Logistics requirement.
- Amendment is refused once CPU has moved the order beyond `draft/needs_review/needs_clarification/accepted/blocked`.
- Allergens: Ad-Hoc sends no allergen evidence. Unchanged lines (same line id and name) keep CPU's evidence; changed or new
  lines return to CPU review. Signed Delivered-In releases are keyed to `menu_planning` orders and never include Ad-Hoc orders.
- Destinations: an OPLOC is re-validated by the Hub against the caller's authorised scope (aliases resolved; label/address
  snapshot from Hub authority). A one-off destination must carry exactly `adhoc-destination:<requestId>` plus an address
  snapshot; it can never be an OPLOC id.

## Failure semantics (Ad-Hoc side, `lib/hub-client.ts`)

| Situation | Result |
| --- | --- |
| Network failure / timeout (10 s) / HTTP 5xx on a **change** | `503 unconfirmed` — "did not confirm… safe to try again". The request is **not** marked sent/cancelled; retry is safe (idempotent). |
| Same on a **read** | `503 unavailable`. Opening a request still works; CPU status is simply omitted. |
| 401 / 403 | Passed through as unauthorised / forbidden. |
| 404 | No order (status → none; cancel → error, never a silent success). |
| Hub 4xx rejection (e.g. "Contact CPU") | Surfaced verbatim; the request keeps its state. |
| Malformed 2xx body | `502 invalid_response`; never trusted. |
| Redirect | Refused (`redirect: "error"`) so credentials are never replayed elsewhere. |

A send/cancel is recorded on the request only **after** the Hub confirms it. If the local write then fails, the retry replays the
same idempotent Hub operation and converges.

## Configuration (staging: `apphosting.staging.yaml`; root directory `apps/ad-hoc-production`)

| Variable | Value / source | Notes |
| --- | --- | --- |
| `FIKA_RUNTIME_MODE` | `staging` | Must not be `local` (hosted runtimes refuse missing config). |
| `FIREBASE_PROJECT_ID` | `fika-os-dev` | Ad-Hoc's own Firestore (its request collection only). |
| `FIKA_HUB_BASE_URL` | `https://staging-os.fikacatering.com` | HTTPS only; validated by `approvedCredentialedUpstream`. |
| `FIKA_INTERNAL_API_TOKEN` | secret `FIKA_INTERNAL_API_TOKEN@3` | Same secret as the Hub; runtime only. The Ad-Hoc backend's service account needs access to this secret. |
| `FIKA_DATA_SOURCE_TRACE` | `1` | Existing diagnostics. |

Not set by this task and not performed: creating the App Hosting backend, granting secret access, any deployment.
