# Beverage Innovation development governance

## Stage B authorisation

Owner authorisation dated 7 November 2026 permits isolated Stage B development for Beverage Innovation while operational stabilisation issues #429 and #423 remain open. This is a scoped governance amendment; it does not mark either issue complete or relax their actual safety gates.

Stage A is the approved visual direction. Preserve its layout and interactions in `/mock`. The current AI-generated or illustrative drink images are placeholders; actual photography for each drink is required before final visual approval or release.
Stage B can record operational and brand review decisions, but final transition to `approved` requires an approved photo asset with a reference. Since Stage B does not import or acquire real photography, final beverage approval and release remain gated until reviewed actual photography is supplied through a later authorized workflow.

## Owner-authorized restricted staging preview — 7 November 2026

The owner authorizes merging eligible Beverage PRs and deploying a dedicated, no-write Stage A visual preview to FIKA OS staging. This amendment permits staging preview hosting and authenticated read-only UAT while #423 and #429 remain open; neither stabilisation issue is resolved or waived.

- The staging entry renders the approved `/mock` prototype. All demo interactions stay in the browser and use fictional content. Beverage `/api/*` mutation and data routes are hidden in preview mode; only the read-only build identity endpoint is public.
- The preview requires the shared FIKA staging session cookie, verifies it against Firebase Authentication in `fika-os-dev` with revocation checking, and allows only explicitly configured verified reviewer identities. The initial configured reviewer is the owner. Missing or misconfigured access settings fail closed. An unauthenticated visit redirects to the staging Hub sign-in; return to the Beverage URL with browser Back or reopen it after signing in. The Hub's existing staging return allowlist is not changed by this Beverage-only preview.
- The preview runtime does not configure a Firestore emulator and uses a dedicated staging App Hosting target. Its no-write presentation route does not read or write Firestore, Calendar, Drive, operational data, or external messaging services. Stage B record APIs remain local-fixture-only.
- Use only the governed `fika deploy beverage --staging` exact-source release path after successful main CI and a verified empty backend with automatic rollouts disabled. Beverage has no production target. Staging visual review does not imply final visual approval, functional data approval, or release acceptance.
- Functional staging writes require a separate verified staging database, AUTHMOD identity and permission contract, OPLOC enforcement, audit/persistence boundary and external-effect review. Do not enable those writes as part of the visual preview. External Gmail access is unverified until an authorized account signs in successfully.
- Actual approved drink photographs remain required before final visual approval or production release. Placeholder imagery must stay labelled as provisional.

## Allowed Stage B work

- Beverage domain models, schemas, recipe quantities and cost/GP calculations.
- Immutable recipe version history, draft and approval workflows.
- Monthly special drafts, fixture-site assignment and date scheduling.
- Local import parsing, source fingerprinting, duplicate warnings and preview.
- Local persistence in the dedicated Beverage Firestore emulator and tests against it.
- Fictional fixture data, unit/contract/integration tests and development documentation.

## Enforced boundaries

- Stage B record APIs accept only local development with `FIKA_RUNTIME_MODE=local`, project `demo-fika-os` or `fika-os-local`, loopback Firestore emulator and `FIKA_BEVERAGE_LOCAL_AUTH=fixture`. The separate Stage A preview runtime can use staging mode only for the restricted read-only route described above.
- The Admin SDK is server-only. Firestore client rules deny every read and write. API routes reject non-local runtimes and non-loopback browser requests. No production/staging database config or live AUTHMOD registration is included.
- Local fixture actor IDs and OPLOC scopes must be fictional `fixture:` identities. Authorization checks are server-side and action-scoped; client-supplied role labels are not trusted.
- Every material write uses an idempotency key, expected aggregate version and atomic entity-plus-audit event transaction. Audit events are append-only command receipts; records are schema-validated on read and fail closed on integrity errors.
- Cost basis is GBP per serving ex VAT. Recipe quantity and cost units must match. Missing price, cost, quantity or unit stays incomplete; allergens are never inferred and remain unrecorded pending the canonical source.
- No production datasets, operational integrations, outbound notifications, customer/supplier/staff messaging, operational publication, or external side effects. Preview auth may verify a session against staging Firebase Auth; no staging Firestore data is accessed.
- No Beverage operational record writes to staging while #429 containment is unverified. The owner-authorized read-only visual preview deployment is an explicit exception. Do not modify Menu Planning publication or allergen safety under Beverage scope. Do not claim #423 or #429 is complete.
- The owner-authorized scope includes eligible preview PR merges and the restricted staging preview release through the existing gates. It does not authorize production deployment, live beverage publication, or functional staging writes before their individual safety checks pass.
- Keep all source changes in a governed isolated workspace and branch; preserve Stage A evidence. Open a PR and merge only exact-source changes that pass required CI and remain within this preview/functional-staging boundary.

## Complexity routing

- **Complexity:** High — persistence, authorization boundaries, audit/version semantics and multiple core workflows.
- **Recommended model:** Sol.
- **Reason:** Correctness depends on atomic local persistence and fail-closed behavior across the domain, API and UI.

## Local development

Use a Firebase CLI already provided by the repository development environment. From this directory:

```powershell
npm ci
$env:FIKA_RUNTIME_MODE = "local"
$env:FIREBASE_PROJECT_ID = "demo-fika-os"
$env:FIKA_BEVERAGE_LOCAL_AUTH = "fixture"
npm run dev -- --port 13617
```

In another terminal, from this directory, set the same three environment values and run:

```powershell
firebase emulators:start --only firestore --project demo-fika-os --config firebase.emulator.json
```

Open `http://localhost:13617/`. `/` uses the local Firestore emulator. `/specials` manages fictional monthly launch windows, `/imports` previews and explicitly creates local draft records, and `/mock` remains the Stage A visual prototype with in-memory examples. The emulator listens only on loopback port 8294, uses a separate demo project, and denies browser/client database access.

The API remains fail-closed until fixture auth and emulator mode are configured. `FIKA_RUNTIME_MODE=staging`, `FIKA_RUNTIME_MODE=production`, real Firebase project IDs, non-loopback emulator hosts and non-local browser hosts are not supported.

## Validation

```powershell
npm run typecheck
npm test
npm run test:emulator
npm run build
npm audit
npm audit --omit=dev
```

`npm run test:emulator` runs the isolated emulator integration suite. It needs the Firebase CLI available on PATH. Emulator data uses the demo project and is not production or staging data.
