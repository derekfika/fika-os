# FIKA OS

FIKA OS is FIKA Catering's internal operational software platform. It brings planning, production, site operations and internal services into one governed system, reducing spreadsheet and manual handoffs while retaining clear ownership and auditability.

## Applications

- **Integration Hub / launcher** — authenticated entry point, integrations and AUTHMOD access control.
- **Menu Planning** — menu intent, dish catalogue, portions, destinations, publication and immutable published snapshots.
- **CPU Production** — canonical production work, planning, allergen review, dual sign-off and signed operational releases.
- **Delivered-In** — site-facing projection consuming governed CPU packets, with menu generation and Grab & Go ordering.
- **Hospitality Booking** — booking, quoting, menu selection and governed production handoff.
- **Logistics** — delivery planning, assignment, dispatch and collection workflows.
- **Ad-Hoc Production** and **Beverage Innovation** — repository applications whose workflows remain limited or evolving; do not treat unfinished areas as production-ready.
- **Events Dashboard** and legacy `sites/` applications — retained operational or compatibility surfaces where present.

## Workflow boundaries

Menu Planning owns menu intent and portions, then publishes an immutable day/week snapshot. CPU Production consumes that publication, owns production planning and the authoritative allergen matrix, and releases signed PDFs and compressed machine packets only after the required review and signatures. Delivered-In consumes the verified CPU packet and filters it by each site's actual allocated dishes.

Hospitality owns booking and commercial workflow. A governed handoff creates or updates canonical production work in CPU; downstream production and fulfilment state is not silently authored by the booking UI.

## Architecture principles

FIKA OS uses canonical domain ownership, stable IDs, immutable publication and release lineage, auditable state changes, idempotent handoffs and replay, bounded read paths, and fail-closed behaviour for sensitive access and read failures. Published projections and compressed immutable read packages are performance/read models, never silent replacements for canonical business state. Server/process caches and IndexedDB client caches improve performance but are validated, scoped and disposable. AUTHMOD governs access server-side.

Applications are Next.js packages deployed through Firebase App Hosting staging. Firestore and other authoritative services remain behind server/API boundaries. Gzip-backed packages preserve and verify their compressed-byte hashes before decompression.

## Repository structure

`apps/` contains application packages; `packages/server-shared/` contains shared server contracts and adapters; `docs/` contains architecture, deployment and audit guidance; `services/` contains supporting services; `sites/` contains legacy or compatibility applications. Mutable runtime data, caches and local databases are not source control.

## Canonical Development Source

Local repository:
C:\FIKA

Canonical branch:
main

main is the only development branch.

All Codex work is performed directly in C:\FIKA on main.

No development branches, alternate worktrees, parallel clones or cherry-pick-based integration are used in the normal workflow.

## Local development and testing

Install dependencies in the app being changed and use its `package.json` scripts. The root supervisor provides local orchestration. Run focused tests first, then affected app tests, typechecks and production builds; finish with `git diff --check`. Use isolated fixtures and emulators for test data.

## Staging and deployment

Staging uses Firebase project `fika-os-dev` and Firebase App Hosting backends configured under each app. Friendly staging domains are configured where available. Never commit secret values. Production deployment, migrations and operational data changes require explicit authorisation.

The normal staging reset preserves reusable `fikaMenuPlanningWeeks` history. If complete planning-history deletion is explicitly required, use the separate hard-reset flag and the approved rebuild command:

```powershell
npm run staging:reset -- --confirm-staging-reset --hard-reset-planning-history --rebuild-command "npm run staging:rebuild"
```

## Architecture and documentation

Read the relevant root and nested `AGENTS.md`, architecture documents, specifications, `COST-EFFICIENCY.md`, `LOCAL-WORKSPACE.md` and audit guidance before changing a boundary. Preserve stable identity, history, ownership, bounded reads, audit evidence and fail-closed semantics.

## Source-control policy

Keep one clean checkout on `main`. Understand the worktree before editing, pull with fast-forward-only, commit validated changes sequentially, and push `main` after successful work unless explicitly told not to.
