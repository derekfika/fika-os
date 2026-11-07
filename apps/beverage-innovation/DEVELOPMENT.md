# Beverage Innovation development governance

## Stage B authorisation

Owner authorisation dated 7 November 2026 permits isolated Stage B development for Beverage Innovation while operational stabilisation issues #429 and #423 remain open. This is a scoped governance amendment; it does not mark either issue complete or relax their actual safety gates.

Stage A is the approved visual direction. Preserve its layout and interactions in `/mock`. The current AI-generated or illustrative drink images are placeholders; actual photography for each drink is required before final visual approval or release.
Stage B can record operational and brand review decisions, but final transition to `approved` requires an approved photo asset with a reference. Since Stage B does not import or acquire real photography, final beverage approval and release remain gated until reviewed actual photography is supplied through a later authorized workflow.

## Owner-authorized restricted staging preview — 7 November 2026

The owner authorizes merging eligible Beverage PRs and deploying a dedicated, no-write Stage A visual preview to FIKA OS staging. This amendment permits staging preview hosting and authenticated read-only UAT while #423 and #429 remain open; neither stabilisation issue is resolved or waived.

- The staging entry keeps the approved prototype shell and presents empty states without fictional drinks, costs, locations, schedules or approval records. The blank drink editor keeps entries in page memory only and cannot save or submit. Local `/mock` retains the original fictional visual reference. The default preview hides Beverage mutation and data routes. Only build identity is public. The optional authenticated OPLOC read is gated separately below.
- The preview requires the shared FIKA staging session cookie, verifies it against Firebase Authentication in `fika-os-dev` with revocation checking, and allows only explicitly configured verified reviewer identities. The initial configured reviewer is the owner. Missing or misconfigured access settings fail closed. An unauthenticated visit redirects to the staging Hub sign-in; return to the Beverage URL with browser Back or reopen it after signing in. The Hub's existing staging return allowlist is not changed by this Beverage-only preview.
- The preview runtime does not configure a Firestore emulator and uses a dedicated staging App Hosting target. The default no-write presentation does not connect to Firestore, Calendar, Drive, operational data or external messaging services. Stage B record APIs remain local-fixture-only.
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

## Stage B recipe import

Start with local extraction and human review. A source can contain up to 20 drinks and 20,000 characters. Use a new `Name:` or `Drink:` label for each recipe, or put `---` between blocks with unlabelled titles. The local page accepts pasted text or DOCX, PPTX and PDF exports, lets the reviewer select and edit each candidate, then explicitly creates one reviewed draft at a time. Parser duplicate warnings apply to the original extracted name. An edited name is checked separately against local records before confirmation.

- `POST /api/imports/preview` accepts `{text}` and returns the source fingerprint and ordered candidates with a zero-based `index`, `candidateHash`, `recipe`, `confidence` and `warnings`. Confidence describes extraction completeness and every candidate requires review. Preview performs at most one indexed, limit-one read per distinct candidate name in the local emulator and makes zero writes.
- `POST /api/imports/name-check` requires local Contribute permission and performs one indexed, limit-one lookup for an edited name in the local emulator. It returns a warning signal only and makes no writes.
- `POST /api/imports/commit` requires `text`, `sourceHash`, `candidateIndex`, `candidateHash`, an explicit `classification`, `reviewed: true`, and the `reviewedCandidate` recipe fields. The server reparses the source and validates the selection before writing. Submit the same `Idempotency-Key` when retrying the same review. Changed review content with a reused key conflicts.
- If a local submission returns an unknown result, the page freezes its selected review and retries the identical request and key. Reloading loses that in-memory retry state; check local records before attempting a fresh review.
- A successful commit atomically creates a local draft and one audit event with the source fingerprint and candidate evidence. The source text stays out of persistent storage. Reviewers may correct the recipe fields and supply explicit ingredient amounts and units. Missing quantities, costs and allergen declarations remain unconfirmed and cost, price, dietary and allergen claims in the source are omitted. Local AUTHMOD fixture and demo emulator rules apply to both endpoints.

### Local document adapter API

The local API accepts DOCX main-document paragraphs, PPTX slide text and supported embedded raster images in presentation order, and PDF selectable text in page order. PPTX image layers are shown with slide/object references and SHA-256 fingerprints for human review; they are not attached to drafts or saved as files. Each imported PPTX recipe retains its source slide, any explicit author credit, and unreviewed image object references. Unlabelled slide titles and final bare fields are only provisional parser candidates and carry warnings. Use fictional or approved source files and check reading order and image identity against the original. Layout reconstruction, speaker notes, attachments and OCR are outside the extraction scope. For Google Docs or Slides, export a DOCX, PPTX or PDF manually or paste the text. The adapters make zero Google API requests. The file picker retains the selected file only in the current page session; changing file or source invalidates the preview. An uncertain commit locks that file and review in memory for the same-key retry. If the page is left, check local records before a fresh review.

- `POST /api/imports/documents/preview` accepts multipart form data with a single `file`. It returns the existing preview fields and a `document` object with `format`, `byteLength`, `adapterVersion`, and `textHash`. `sourceHash` is SHA-256 of the original file bytes. Candidate fingerprints also bind those bytes and the adapter version. Duplicate warnings use the existing bounded local lookup. Preview makes zero writes.
- `POST /api/imports/documents/commit` accepts the same original `file` and a multipart `review` string containing JSON. Include `sourceHash`, `candidateIndex`, `candidateHash`, explicit `classification`, `reviewed: true`, and `reviewedCandidate`. Send an `Idempotency-Key` and retry with the same file, review, and key after an uncertain response. The server recomputes extraction and fingerprints before creating one draft and audit event. A different file or candidate returns a conflict. Persisted provenance contains the file name, hashes, format, size, and adapter version. The uploaded bytes and complete extracted text stay in memory only.
- Both routes require local Contribute authority before reading the body and reject cross-origin browser requests. The multipart stream is capped before parsing. PPTX sources are limited to 12 MiB; DOCX and PDF sources are limited to 4 MiB; review data is limited to 128 KiB. Other limits are 40 slides or PDF pages, 100 embedded image objects and 12 MiB of extracted image data, plus the same text and candidate limits as pasted text. OOXML archives are checked for entry count, declared expansion, selected XML/media part sizes and checksums, and XML nesting. External slide targets, DTDs, macro and encrypted documents are unsupported. PDF extraction runs in a separate local Node process with a bounded heap, input, output and time budget. Use Node 22.13 or newer.

The PDF dependency is pinned to `pdfjs-dist` 6.5.438, above the patched version in [Mozilla's PDF.js advisory](https://github.com/mozilla/pdf.js/security/advisories/GHSA-wgrm-67xf-hhpq). The subprocess extracts text from supplied bytes and skips rendering and document actions.

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

## Local permission and site checks

The Stage B fixture uses explicit, independent `View`, `Contribute`, `Manage` and `Approve` actions. View reads drafts and the permitted specials list. Contribute creates or edits draft recipes and imports. Manage controls lifecycle changes and monthly specials. Approve records review decisions. The server validates editable draft fields before persistence so recipe edits cannot set approval, lifecycle, asset, history or actor fields.

Fixture storage requires explicit local mode, the fictional fixture auth setting and loopback emulator configuration. Missing or empty `FIKA_BEVERAGE_LOCAL_AUTH_ACTIONS` or `FIKA_BEVERAGE_LOCAL_OPLOC_IDS` grant no actions or no sites respectively. Configured site IDs must have the fictional `fixture-oploc:` prefix.

Monthly specials are visible only when the actor covers every target OPLOC. Site changes require access to both the stored and proposed targets, and status changes and command retries check the current targets inside the transaction. An unassigned draft is private to its creator until it has a target. The emulator list still reads a bounded window of at most 100 recent plans and filters on the server. A hosted implementation needs a scope-aware indexed list so recent plans outside a reviewer's scope cannot crowd out permitted plans.

## Canonical AUTHMOD dependency for functional staging

Hub owns the [Beverage site decision and internal request adapter](../../docs/architecture/authmod-architecture.md#beverage-site-authority-foundation). The adapter uses the canonical, revocation-checked Firebase cookie and one read-only snapshot for the existing UID binding and current AUTHMOD and OPLOC packages. It requires an explicit app assignment and action grant, and a non-empty scope of active assigned canonical OPLOCs. Full Access does not extend to Beverage. Approval requires an explicit site-scoped grant separate from the normal bundle. The current evidence is from fictional fixtures.

Before functional staging, verify the dedicated transport and the exact Hub project, issuer, cookie origin and read-only package credentials. Verify the deployment's own registry entry and audited grant provisioning without changing the live launcher or default grants. Separately review organisation-scoped recipe access and the transactional OPLOC checks for current and proposed targets. Verify dedicated staging persistence, least-privilege credentials, audit and external-effect containment before enabling any functional data route.

The restricted staging preview uses its existing reviewer allowlist. Beverage record APIs still require the local emulator and fixture auth. External Gmail access remains unverified until an authorised account completes a real sign-in. Stabilisation issues #423 and #429 remain open.

### Optional read-only OPLOC preview

The default preview keeps the Target sites empty state. The optional **Check authorised sites** action in Monthly Specials uses only `GET /api/preview/oplocs` on the Beverage staging custom domain. It requires the existing reviewer allowlist and revocation-checked FIKA session. The server forwards only the canonical cookie and an audience-bound Google ID token to the exact Hub OPLOC route proposed in PR #472. The Google token comes from the existing dedicated Beverage workload identity. Credentials remain server-side and only the requested, authorised canonical site IDs and approved labels are returned. A failed read clears prior displayed sites. The panel offers no assignment or save action.

Both `FIKA_BEVERAGE_HUB_OPLOC_READS=1` and an explicit, bounded comma-separated `FIKA_BEVERAGE_HUB_OPLOC_IDS` list are required in the approved staging preview runtime. Supply current canonical IDs. The bridge requires a matching response for the full requested scope and rejects browser-supplied scope overrides. All mutation APIs stay hidden. This change sets neither runtime value. Tests exercise the request and response contract through an injected fictional Hub and metadata transport without relying on a merged or deployed provider.

Before hosted UAT, integrate and deploy the reviewed Hub provider with the current security baseline, verify its exact caller audience, issuer and trusted HTTPS forwarding, and verify the existing Beverage service account's email and immutable subject in the serving runtime. Confirm the reviewer's pre-bound Firebase UID, explicit Beverage View and assigned active canonical OPLOCs, current read-only Hub packages and the approved scope list. An all-active test uses the verified current inventory and explicit assignments for every included site. Generic AUTHMOD SiteAssignments can affect other assigned apps. Use existing verified assignments or separately govern a Beverage-only scope before expanding them. There is no wildcard or Full Access fallback. Actual external Gmail needs explicit owner-authorised enrollment and real sign-in. Food Data stays gated on an independently verified object-get-only credential. Beverage staging persistence, publication and external effects remain gated.

## Local ingredient and product library

`GET /api/ingredient-library?q=juniper&limit=10` searches a fictional in-memory ingredient catalogue. It requires the existing explicit local fixture runtime and View permission. The request accepts a search of up to 100 characters and a limit from 1 to 50, with a default of 20. Responses are private and uncached. The route makes zero network requests and zero Firestore reads or writes.

The adapter consumes the ingredient portion of the [Hub Food Data v1 snapshot](../integration-hub/docs/food-data-library.md). It verifies the pinned `<snapshot>:<gzipSha256>` version, both byte counts and both hashes before projecting positional rows by column name. It caps gzip at 5 MiB, decoded JSON at 40 MiB, rows at 25,000 and columns at 160. Malformed or mismatched evidence fails closed. Each result has a zero-based source row index scoped to its exact dataset version. Product and supplier codes retain leading zeros, and duplicate rows stay separate. Purchase status is descriptive source text. This search supplies no recipe quantity, cost, allergen or approval evidence.

Before hosted integration, verify a dedicated Hub transport that requires an already-bound UID and explicit Beverage admission with reviewed OPLOC scope. The current live Food Data GET uses the general session resolver, which can bind an email-matched UID and write an audit event. Use a pinned, authorised ingredient snapshot and a read-only object permission boundary with raw gzip delivery and integrity validation. Decide whether supplier and purchase fields may be exposed to each audience. Hosted recipe costing requires separate evidence for price-effective dates, units and an explicitly reviewed ex-VAT basis. Existing preview, external Gmail, persistence and external-effect gates still apply.

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
$env:FIKA_BEVERAGE_LOCAL_AUTH_ACTIONS = "View,Contribute,Manage,Approve"
$env:FIKA_BEVERAGE_LOCAL_OPLOC_IDS = "fixture-oploc:london,fixture-oploc:munich,fixture-oploc:frankfurt,fixture-oploc:amsterdam"
npm run dev -- --port 13617
```

In another terminal, from this directory, start the demo Firestore emulator:

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
