# Beverage Innovation development governance

## Stage B authorisation

Owner authorisation dated 7 November 2026 permits isolated Stage B development for Beverage Innovation while operational stabilisation issues #429 and #423 remain open. This is a scoped governance amendment; it does not mark either issue complete or relax their actual safety gates.

Stage A is the approved visual direction. Preserve its layout and interactions in `/mock`. The current AI-generated or illustrative drink images are placeholders; actual photography for each drink is required before final visual approval or release.
Stage B can record operational and brand review decisions, but final transition to `approved` requires an approved photo asset with a reference. Since Stage B does not import or acquire real photography, final beverage approval and release remain gated until reviewed actual photography is supplied through a later authorized workflow.

## Allowed Stage B work

- Beverage domain models, schemas, recipe quantities and cost/GP calculations.
- Immutable recipe version history, draft and approval workflows.
- Monthly special drafts, fixture-site assignment and date scheduling.
- Local import parsing, source fingerprinting, duplicate warnings and preview.
- Local persistence in the dedicated Beverage Firestore emulator and tests against it.
- Fictional fixture data, unit/contract/integration tests and development documentation.

## Enforced boundaries

- The only enabled runtime is local development with `FIKA_RUNTIME_MODE=local`, project `demo-fika-os` or `fika-os-local`, loopback Firestore emulator and `FIKA_BEVERAGE_LOCAL_AUTH=fixture`.
- The Admin SDK is server-only. Firestore client rules deny every read and write. API routes reject non-local runtimes and non-loopback browser requests. No production/staging database config or live AUTHMOD registration is included.
- Local fixture actor IDs and OPLOC scopes must be fictional `fixture:` identities. Authorization checks are server-side and action-scoped; client-supplied role labels are not trusted.
- Every material write uses an idempotency key, expected aggregate version and atomic entity-plus-audit event transaction. Audit events are append-only command receipts; records are schema-validated on read and fail closed on integrity errors.
- Cost basis is GBP per serving ex VAT. Recipe quantity and cost units must match. Missing price, cost, quantity or unit stays incomplete; allergens are never inferred and remain unrecorded pending the canonical source.
- No production datasets, integrations, outbound notifications, customer/supplier/staff messaging, operational publication, or external side effects.
- Do not write to staging while #429 containment is unverified. Do not modify Menu Planning publication or allergen safety under Beverage scope. Do not claim #423 or #429 is complete.
- Do not deploy, release, merge into main or begin Stages C/D without explicit authorization and the existing governance gates. Stage C/D production integration and deployment remain blocked by stabilisation and later owner authorization.
- Keep all source changes in a governed isolated workspace and branch; preserve Stage A evidence. Open a PR for review and do not merge before owner approval.

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
