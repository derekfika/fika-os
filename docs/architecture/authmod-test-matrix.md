# AUTHMOD security and access test matrix (Phase A)

These are first-class acceptance cases for the shared decision layer and route adapters. Tests should use isolated stores and stable fixture IDs, not display names or state left by another test.

| ID | Scenario | Expected result |
|---|---|---|
| AUTH-01 | Unauthenticated direct app URL | Redirect to central login and preserve safe return URL |
| AUTH-02 | Authenticated user without app grant | 403 and app absent from launch panel |
| AUTH-03 | Hospitality + MNK only, request Munich RE | Deny and return no Munich RE data |
| AUTH-04 | Delivered-In View-only user | GET allowed; Grab & Go POST denied |
| AUTH-05 | Menu user with explicit Publish | Publish allowed without AUTHMOD Admin |
| AUTH-06 | AUTHMOD Admin without Menu Publish | Menu publish denied |
| AUTH-07 | Full Access without allergen authority | Allergen signing denied |
| AUTH-08 | Production signer with matching grant | Production sign allowed only for authorized scope/role |
| AUTH-09 | Final approver with matching grant | Final approval allowed only for authorized scope/role |
| AUTH-10 | Same UID attempts both required signatures | Denied when separation-of-duties policy requires distinct actors |
| AUTH-11 | Delivered-In human lacks CPU app; Delivered-In service is granted | Human CPU access denied; service projection read allowed |
| AUTH-12 | Public Hospitality booking | Unauthenticated booking submission still works |
| AUTH-13 | Hospitality manager site A requests site B | Denied with no site B data |
| AUTH-14 | Client sends by/actor/updatedBy/generatedBy | Fields ignored for authorization and audit actor |
| AUTH-15 | User deactivated/revoked | Existing protected requests lose access |
| AUTH-16 | Assignment expired | No longer authorizes |
| AUTH-17 | Logout | Subsequent requests to all apps require login |
| AUTH-18 | AUTHMOD grant mutation | Audit event has authenticated admin UID and before/after state |
| AUTH-19 | AUTHMOD store unavailable | Protected request fails closed; no admin fallback |
| AUTH-20 | Service principal revoked | Internal request denied |

Additional import tests should cover duplicate rows, low-confidence matches, unresolved rows, unknown OPLOC columns, idempotent commit retry, stale version, deactivation, and preserving grants outside merge scope. Additional audit tests should verify bounded queries and absence of audit writes for successful reads/polling.
