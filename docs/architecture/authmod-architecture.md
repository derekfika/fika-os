# AUTHMOD architecture (Phase A)

Status: Phase A design input. The staged Pack 2 ROLE documents and schemas are drafts; this document adopts their core concepts but does not adopt every field as mandatory.

## Scope

AUTHMOD covers Integration Hub, CPU Production, Logistics, Menu Planning, Hospitality internal management, Delivered-In including Grab & Go, and Ad-Hoc Production. Events Dashboard and Beverage Innovation are explicitly out of scope. Public Hospitality booking remains unauthenticated.

## Design decisions

1. **Legend, interactive identity, operational account, custodian and service principal are separate.** An immutable AuthIdentity ID represents an interactive account and has `identityKind: person | operational`; a person identity may link to one canonical Legend, while an operational identity may represent an OPLOC or function and is never that Legend. Email is a matching/display attribute, not identity. ServicePrincipal represents software, not a shared Workspace account.
2. **The runtime source is FIKA-owned AUTHMOD persistence.** Workspace spreadsheets are import sources and optional future bulk-edit sources only. Applications never query a spreadsheet on a request path.
3. **Effective access is an intersection.** An interactive request is authorised only when the identity is active, the app grant is active, the requested OPLOC is assigned (where the capability is site-scoped), and the action grant is active. Operational accounts are legitimate interactive principals for normal operations. No combined site_app permission vocabulary is needed for v1.
   The administration surface presents ordinary app access as a standard application bundle: one app choice atomically manages the AppAssignment and that app's reviewed normal View/Contribute/Manage grants. Special authority remains explicit and separate.
   Standard grants are application-normal and organisation-scoped; they do not contain a current site list. SiteAssignments are checked dynamically for every requested OPLOC.
   Operational authority evaluation fails closed when its OPLOC scope is omitted; app-entry resolution may still omit an OPLOC. Every requested OPLOC must also be an active canonical OPLOC, not merely an effective historical SiteAssignment.
4. **Full Access is a convenience grant, not administration or business authority.** It expands to the normal in-scope app and OPLOC set at evaluation time, but never grants AUTHMOD Admin, Approve, Publish, or safety sign-off.
5. **Actions remain controlled:** View, Contribute, Manage, Approve, Publish, Administer. Manage does not imply Approve or Publish; Administer does not imply business authority.
6. **Authority is explicit and effective-dated.** Job titles, BrightHR titles, email domains, app visibility, and technical access do not create grants. Temporary/delegated grants require an end date and audit evidence.
7. **Separate service principals represent machine callers.** A service principal has its own stable ID, credentials/keys metadata, resource/action grants, scope, status and audit trail. It is never a fake employee and does not inherit a human's access.
   Custodianship is a separate audited governance relationship: a person Legend may be custodian of one or more operational identities, but custody grants no access and does not change the authenticated actor.
8. **Fail closed.** An unavailable AUTHMOD decision denies protected requests. Development-only synthetic fallbacks remain behind explicit local safety checks until central production login exists.
9. **Central session, local enforcement.** Firebase may remain the identity provider. Integration Hub should exchange verified Firebase identity proof for a short-lived, revocable, HttpOnly central session; every app calls the shared authorization decision layer or verifies the same session. The launch panel is UX, not security.
10. **Audit is server-derived.** Actor UID/principal ID, display/email snapshot, target, action, before/after state, scope, timestamp, source, correlation/causation and outcome are captured at the authoritative write boundary. Client fields such as by, actor, updatedBy and generatedBy are never trusted as actor proof.

## Conceptual request flow

    Firebase identity proof or service credential
            -> central authenticated session / principal
            -> AUTHMOD decision: identity + app + action + scope + effective dates
            -> application handler
            -> durable domain mutation and audit/domain event

Direct unauthenticated human navigation redirects to central login with a validated return URL. An authenticated but unauthorized request returns 403. A site parameter is checked against the canonical OPLOC assignment before any data is returned.

## Core authorization API

The shared server-side package should expose a small decision-oriented API, with adapters for the current Next.js apps:

    requireAuthenticatedUser(request)
    requireAppAccess(request, { appId })
    requireAuthority(request, { appId, resource, action, scope })
    requireServiceAuthority(request, { service, resource, action, scope })
    resolveUserAccess(request, { appId?, requestedOplocId? })

The result should contain the immutable principal, active user status, matched grant IDs/versions, effective OPLOC IDs and a decision reason suitable for diagnostics. It must not expose sensitive grant detail unnecessarily to clients.

## App registry

The registry is FIKA-owned and keyed by stable IDs: integration-hub, cpu-production, logistics, menu-planning, hospitality-booking, delivered-in, and ad-hoc-production. Each record contains display name, canonical URL/route, enabled/launch-visible status, scope model (none, oploc, mixed), and optional icon metadata. Events and Beverage are absent from the v1 launch registry. App definitions are consumed by the Hub launcher and access checks rather than duplicated in each frontend.

## Special authority v1

Keep v1 small and evidence-based:

- Menu Planning: menu.publish (Publish, separate from Hub Administer).
- CPU Production: production.allergen-sign (Approve/sign production role) and production.allergen-final-approve (Approve/final role), explicit organisation-level capabilities. The authenticated account must still have CPU access and any relevant site access for the workflow; the authority itself is not tied to an OPLOC.
- Logistics: logistics.repair, logistics.reconcile, logistics.reset or a reviewed equivalent only if route analysis confirms they are privileged maintenance actions.
- Integration Hub: authmod.admin (Administer), separate from business approval/publication.

The two allergen positions should require distinct authenticated actors when both signatures are required; the same UID must not satisfy both positions unless an explicit, separately approved exception exists.

## Session migration

Current Firebase emulator sign-in is retained as a local-only scaffold. Phase B should introduce a central session abstraction so apps no longer know the synthetic role catalogue. Production cookies should be Secure, HttpOnly, SameSite=Lax or stricter as the cross-origin deployment requires, short-lived with controlled renewal, revocable, and cleared on logout. Direct app navigation must preserve a safe same-origin return path. Do not persist a raw emulator ID token as a year-long production session.

## Public and service boundaries

Public Hospitality customer booking submission and public static/reference routes stay outside normal employee guards. Internal Hospitality management and its write APIs are interactive-authorized and OPLOC-scoped. Bridge routes use dedicated service credentials. CPU projections consumed by Delivered-In use a service principal, so a Delivered-In interactive account does not need CPU application access.

## Audit and operational cost

Use the existing durable domain/change event where it contains the required evidence; do not add a duplicate Firestore write for every mutation by default. Audit queries are bounded and paginated. No audit writes occur for reads, polling or renders. Access changes, import commits, grant revocations, service-principal changes and emergency access are meaningful mutations and require durable evidence. Security state and its audit event are written through repository transactions where supported.

## Explicit non-decisions

This phase does not choose Firebase versus another IdP, a final database collection naming scheme, a complete organisational role catalogue, automatic role templates, emergency-access workflow details, or broad app guard implementation. Those are implementation decisions after route and permission review.
