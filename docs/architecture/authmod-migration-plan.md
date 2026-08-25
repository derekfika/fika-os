# AUTHMOD migration plan (Phase A)

## Phase A — inventory and design (this delivery)

- Preserve checkpoint branch behavior and create feature/authmod-access-control.
- Adopt the staged ROLE-001..007 concepts as draft inputs: separate roles/assignments/authority, controlled actions, explicit scopes, approval/publication separation, access boundaries and emergency-access traceability.
- Create the route inventory, permission matrix, data model, architecture and this migration plan.
- Record public/service exceptions and current vulnerabilities before adding broad guards.

Exit criterion: route and permission classifications are reviewed enough to define the first protected slices without changing operational behavior.

## Phase B — AUTHMOD core

1. Add canonical persistence for identities, Legend links, app registry, OPLOC/app assignments, explicit grants, service principals, imports and audit events.
2. Add immutable-ID and effective-date validation, optimistic versions and idempotency keys.
3. Implement the shared server-side decision API with human/service paths and fail-closed behavior.
4. Add Legend/BrightHR candidate reconciliation with default NO ACCESS.
5. Add spreadsheet parser, preview/reconciliation, explicit match resolution and commit transaction. Keep unresolved rows out of authorization.
6. Add focused tests for the 20 UAT cases in the brief, especially Full Access versus Admin, site intersection, two allergen actors, public routes and service access.

## Phase C — Integration Hub AUTHMOD UI

Create /authmod as a first-class Hub section. The main table shows person, email, Legend status, active status, access summary, Full Access and AUTHMOD Admin. Search/filter prevents an enormous matrix. A side panel edits identity/link, OPLOC assignments, app assignments and a small evidence-based special-authority list. Separate tabs/sections handle import preview/reconciliation, audit history and service principals. Every write uses the server-side actor and returns an audit event.

Proposed person panel:

    Identity       name, workspace email, Legend link, status, provenance
    Sites          canonical OPLOC checklist / effective dates
    Applications   Integration Hub, CPU, Logistics, Menu, Hospitality,
                   Delivered-In, Ad-Hoc
    Authority      Menu Publish, CPU sign/final approval, reviewed logistics
                   maintenance, AUTHMOD Admin
    History        grants, revocations, import source, actor and timestamps

## Phase D — central login and launcher

Replace the local role selector with Firebase-backed identity proof and a central secure session. Keep emulator scaffolding explicitly local-only until production identity is configured. Build the Hub root as My FIKA OS from the central registry; move governance/admin workspace to a deeper route if needed. Add logout, expiry/revocation and safe return URLs.

## Phase E — incremental enforcement

Recommended order:

1. Logistics: eliminate client actor attribution first, then guard actions and maintenance routes.
2. Hospitality internal routes: classify public customer routes separately and enforce OPLOC on managers.
3. Menu Planning: protect reads/mutations and split Publish from Manage.
4. CPU: protect production routes and derive allergen signatory authority server-side.
5. Delivered-In/Grab & Go: replace synthetic access with canonical assignments; deny view-only mutations.
6. Ad-Hoc Production: replace synthetic Hub roles with app/action/scope decisions.
7. Integration Hub internal/governance routes: map technical admin to Administer without granting business Publish/Approve.

Introduce service-principal authentication alongside each cross-app dependency. First standardize the existing FIKA_INTERNAL_API_TOKEN, x-fika-internal-token, bridge-token and projection-client patterns behind one transitional verifier; then rotate to named principals and scoped credentials. Never make a single global token the final model.

## Rollout and safety

- Start in local/emulator and a test dataset with explicit deny-by-default behavior.
- Import spreadsheet data in preview-only mode first; export a reconciliation report and retain the source hash.
- Seed users as NO ACCESS unless an administrator commits reviewed grants.
- Run dual-read/decision logging before switching a route, but do not let logging silently allow a request.
- Keep a break-glass path only as a separately audited, time-limited emergency grant; no undocumented admin bypass.
- Measure command latency and downstream visibility separately; avoid broad realtime listeners and per-read audit writes.

## Unresolved decisions

- Production identity provider and deployment topology for the central session.
- Canonical AUTHMOD storage transaction boundary and retention policy.
- Exact OPLOC source/selection rules for Full Access and app-specific scopes.
- Final organisational role catalogue and who approves each business authority.
- Which Logistics maintenance actions are Administer versus a narrower named authority.
- Whether any legitimate exception permits one actor to hold both allergen signatures; default recommendation is no.
- Service credential issuance, rotation and secret-manager ownership.
