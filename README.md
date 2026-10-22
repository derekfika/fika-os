# FIKA OS

FIKA OS is FIKA Catering's internal operational software platform. It brings planning, production, site operations and internal services into one governed system, reducing spreadsheet and manual handoffs while retaining clear ownership and auditability.

## TL;DR

FIKA OS is an operational platform connecting Menu Planning, CPU Production, Delivered-In, Hospitality Booking and Logistics. The solo owner directs AI agents; agents handle isolated workspaces, tests, CI and release mechanics. `main` is the sole integration branch. Production always needs an explicit owner release instruction. Normal staging reset preserves reusable `fikaMenuPlanningWeeks` history.

## Working with an agent

| Owner says | Agent does |
|---|---|
| "Implement this" | Creates an isolated workspace, implements, tests and prepares the change. No production deployment. |
| "Put it on staging" | Resolves the candidate and deploys only the selected staging application, then verifies it. |
| "Ship it" | Records explicit production authorisation, validates the full change and required staging evidence, deploys the selected app and verifies the exact serving source. |
| "Roll it back" | Selects the verified previous release automatically, performs the authorised rollback and verifies it. |

No manual SHAs, GitHub approval comments or independent human PR approvals are required. PRs and required CI remain useful automated integration safeguards; agents can integrate a green PR when the owner authorises integration. Genuinely cosmetic releases can go from CI to production after owner approval; operational and data-sensitive changes must pass staging first. An ordinary coding request never authorises production deployment.

The existing authorised local deployment path works without hosted GCP workload identity. Release ledgers and recovery journals protect operations internally. See the [operator guide](docs/deployment/workflow.md) for agent commands and failure recovery.

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

The shared repository is `C:\Fika\fika-os`; `origin/main` is authoritative. Agents use scoped isolated worktrees and temporary branches from a recorded main baseline. They do not create separate clones, overwrite each other's files or force-push main. Dependencies, build output and local test state remain isolated. Approved work integrates sequentially through passing CI.

## Local development and testing

Install dependencies in the app being changed and use its `package.json` scripts. The root supervisor provides local orchestration. Run focused tests first, then affected app tests, typechecks and production builds; finish with `git diff --check`. Use isolated fixtures and emulators for test data.

## Staging and deployment

Staging uses Firebase project `fika-os-dev` and Firebase App Hosting backends configured under each app. Friendly staging domains are configured where available. Never commit secret values. Production deployment, migrations and operational data changes require explicit authorisation.

The normal staging reset preserves reusable `fikaMenuPlanningWeeks` history. If complete planning-history deletion is explicitly required, use the separate hard-reset flag and the approved rebuild command:

```powershell
npm run staging:reset -- --confirm-staging-reset --hard-reset-planning-history --rebuild-command "npm run staging:rebuild"
```

## Architecture and documentation

Start with the concise [root agent guide](AGENTS.md), then only the affected app guides: [Integration Hub](apps/integration-hub/AGENTS.md), [Hospitality](apps/hospitality-booking/AGENTS.md), [Menu Planning](apps/menu-planning/AGENTS.md), [CPU Production](apps/cpu-production/AGENTS.md), [Delivered-In](apps/delivered-in/AGENTS.md) and [Logistics](apps/logistics/AGENTS.md). Root rules apply globally; scoped guides add ownership, contract boundaries, tests and links rather than repeating platform policy.

Codex reads the applicable AGENTS.md hierarchy. Root and app-level CLAUDE.md files are import-only wrappers for the same guides, using [Claude's documented file imports and scoped loading](https://code.claude.com/docs/en/memory); do not maintain a second policy copy. From a root-started session, explicitly read the affected app guide before editing. Existing generated Next.js instructions remain intact. Check loaded context in the agent session when diagnosing instruction-discovery problems; links to detailed references do not automatically load every architecture document.

The [detailed platform reference](docs/ai/agent-reference.md) retains the former root's safety, persistence, performance, audit and testing requirements. Use the root task-routing table to load relevant sections before changing those boundaries. A small UI change needs its app guide and the [Style Guide](docs/STYLE-GUIDE.md); CPU signing, production quantities or other data changes additionally require the applicable detailed safety rules. See also [operator workflow](docs/deployment/workflow.md), [cost guardrails](COST-EFFICIENCY.md), [local runtime](LOCAL-WORKSPACE.md) and [logging/audit strategy](docs/ai/LOGGING-AUDIT-STRATEGY.md).

## Source-control policy

Keep the canonical main checkout clean and preserve other agents' work. Agents commit and push validated task branches, use PR CI, and integrate only within the owner's authorisation. Mandatory independent approvals are disabled; automated checks and force-push protection remain. Deployment is a separate explicit instruction, not a consequence of pushing or merging. Never discard unique work, stashes or recovery history to simplify Git.
