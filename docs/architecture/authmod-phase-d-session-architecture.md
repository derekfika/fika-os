# AUTHMOD Phase D.1 — FIKA OS session architecture

## Boundary

Firebase Authentication proves which external account is signed in. AUTHMOD remains the live source of truth for applications, OPLOCs, Full Access, special authority and administration. Those entitlements are deliberately not copied into the FIKA OS session cookie, so grants, revocations, expiry and identity deactivation take effect without requiring a new login.

The production boundary is:

```text
Firebase Google sign-in
  -> verified Firebase ID token
  -> server-side AUTHMOD identity resolution/binding
  -> Firebase Admin session cookie (fika_os_session)
  -> current AUTHMOD authorization evaluation
```

The cookie is HttpOnly, path `/`, SameSite Lax, Secure outside local runtime, bounded to a configurable maximum of seven days by default and fourteen days absolutely. An optional `FIKA_SESSION_COOKIE_DOMAIN` supports a future shared parent domain; localhost never receives a Domain attribute.

## Identity mapping

`FikaSessionPrincipal` contains the Firebase UID, AUTHMOD identity ID, display name/email, identity kind and operational custodian context. It does not contain roles, applications, sites or authority grants. Existing AuthIdentity records are matched first by the immutable `firebase` provider/UID binding, then by one exact normalized email match. A safe email match is explicitly bound and audited. Unknown, inactive, conflicting or multiply-bound identities are denied; a Workspace email does not create an AUTHMOD account automatically.

Both Person and Operational identities may sign in. An operational session remains attributed to the operational AUTHMOD identity. A custodian is context only and is never substituted as the actor or food-safety signatory.

## Session endpoints and protection

`POST /api/auth/session` accepts a verified client Firebase ID token plus a CSRF token. The server requires a same-origin request, a recently authenticated verified email in `FIKA_ALLOWED_EMAIL_DOMAINS` (default `fikacatering.com`), resolves AUTHMOD, and calls Firebase Admin `createSessionCookie()`. `GET` returns only non-sensitive canonical principal information. `DELETE` clears the cookie with matching attributes. CSRF tokens are issued by `GET /api/auth/csrf` and are non-HttpOnly; the session cookie is never a raw Firebase ID token.

Firebase session-cookie verification uses revocation checking. Firebase session revocation and AUTHMOD deactivation are separate controls: `requireFikaSession()` checks both.

## Runtime and credentials

`FIKA_RUNTIME_MODE` distinguishes `local`, `staging` and `production`. Local mode requires safe project IDs and loopback Auth/Firestore emulators. Staging/production reject emulator variables and initialize Firebase Admin through Application Default Credentials; no service-account JSON is checked in. Client Firebase configuration is optional `NEXT_PUBLIC_FIREBASE_*` configuration and contains no server secret.

The local-only `/api/auth/local-session` endpoint is an explicit emulator adapter. It creates the existing synthetic development fixture identities, including the administrator grant, only after `assertLocalSafety()`, then mints the same Firebase session-cookie format. Synthetic labels are compatibility fixtures, not production identity or authorization claims. Hub localStorage is not used as authentication proof.

## Deferred work

Phase D.2/D.3 will complete client Google sign-in UX, deployment configuration and broader session adoption as required. Phase E owns operational route enforcement and migration of remaining legacy Hub role checks. Emergency break-glass, real custom domains, service-token migration and full application redirects remain deferred.
