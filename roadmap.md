# FIKA Platform Roadmap

## Vision

Build a cohesive operational platform that allows FIKA to grow without multiplying manual work, duplicated code, or setup complexity.

The long-term target is simple:

> A new FIKA site, booking platform, or dashboard should be created primarily through configuration rather than a fresh build.

Every architectural decision should make the next FIKA location easier to open than the previous one.

---

## Scope

This roadmap covers the core FIKA operational platform, including:

- Hospitality booking platforms
- Hospitality dashboards
- CPU production workflows
- Logistics workflows
- Events dashboard
- FIKA events and pop-up client experience
- The Line event feed into the shared internal events dashboard
- Quote generation
- PDF and brochure generation
- Calendar event creation
- Gmail and Drive workflows
- BrightHR employee data
- Hospitality menus and brochure data
- Pop-up brochure data
- Site configuration
- Till integrations and the Square-to-SumUp migration
- Shared logging, schemas, utilities, and workflows
- Codex project instructions, skills, and local MCP tooling

Explicitly out of scope:

- Bloom applications
- HomeBuck
- Personal projects
- Unrelated experimental tools

Bloom should remain architecturally separate from the main FIKA platform.

---

## Guiding Principles

1. Do not rewrite working systems without a clear reason.
2. Migrate gradually and preserve business continuity.
3. Prefer configuration over duplicated code.
4. Prefer canonical objects over spreadsheet inference.
5. Prefer shared workflows over repeated functions.
6. Prefer small, reversible changes over large migrations.
7. Measure performance before changing architecture.
8. Keep Sheets as useful operational and reporting surfaces, but not necessarily as the only application database.
9. Keep credentials outside repositories.
10. Build the Events platform as the first flagship product using the new standards.

---

# Roadmap Overview

## Stage 1 — Platform Foundations

- Define the scope and boundaries of the FIKA platform.
- Create the central `fika-platform-specs` repository.
- Inventory active FIKA operational applications.
- Record repositories, deployments, Sheets, Drive folders, Calendars, and integrations.
- Identify duplicated functions and hardcoded configuration.
- Identify slow and fragile applications.
- Define repository naming and documentation standards.
- Create the first global `AGENTS.md`.
- Produce a current-state system map.
- Select the first priority applications and workflows.

**Outcome:** FIKA has a documented platform boundary, a source-of-truth repository, and a clear starting point.

---

## Stage 2 — Repository and Codex Standards

- Add `AGENTS.md` to every active repository.
- Add or improve `README.md`.
- Record setup, deployment, and dependency information.
- Standardise branch and release practices.
- Add changelogs where useful.
- Archive obsolete duplicates.
- Require Codex to inspect before editing.
- Require build, test, review, and regression checks.

**Outcome:** Codex behaves consistently and each application is understandable and recoverable.

---

## Stage 3 — Schema Catalogue

Create a versioned FIKA schema catalogue.

Initial schemas should include:

- `FikaSite`
- `FikaAppConfig`
- `FikaBooking`
- `FikaBookingItem`
- `FikaCustomer`
- `FikaQuote`
- `FikaCalendarEvent`
- `FikaHospitalitySection`
- `FikaHospitalityItem`
- `FikaHospitalityItemOverride`
- `FikaHospitalityBrochureConfig`
- `FikaPopupPackage`
- `FikaPopupPackageItem`
- `FikaPopupAddon`
- `FikaPopupBrochureConfig`
- `FikaEmployee`
- `FikaEvent`
- `FikaEventEnquiry`
- `FikaEventVenue`
- `FikaEventLabourRequirement`
- `FikaEventEquipmentRequirement`
- `FikaEventLogisticsJob`
- `FikaEventCostLine`
- `FikaEventTask`
- `FikaProductionOrder`
- `FikaDeliveryJob`
- `FikaTillLocation`
- `FikaTillItem`
- `FikaSalesRecord`
- `FikaAuditEvent`
- `FikaMediaAsset`

All schemas should use consistent conventions where appropriate:

- `schemaVersion`
- Stable IDs
- Status values
- `createdAt`
- `updatedAt`
- `createdBy`
- `source`
- Record `version`
- Validation rules
- Example fixtures

**Outcome:** FIKA applications begin speaking the same language.

---

## Stage 4 — Central Configuration

Create one authoritative configuration layer for:

- Sites
- Clients
- Applications
- Sheet IDs
- Drive folder IDs
- Calendar IDs
- Branding
- Email recipients
- Current till provider
- Square identifiers
- SumUp or Goodtill identifiers
- Migration status
- Enabled features
- Menu assignments
- Permissions
- Deployment information

Start with controlled JSON or a well-structured Google Sheet.

Separate:

- Safe configuration that can be committed
- Private configuration that stays local or in secure properties

**Outcome:** Applications ask for configuration instead of hardcoding it.

---

## Stage 5 — Performance Audit and Optimisation

For priority applications:

- Measure actual load times.
- Record slow functions.
- Count Sheets, Drive, and API calls.
- Replace cell-by-cell reads with batch reads.
- Replace repeated Drive searches with stored IDs.
- Cache static configuration.
- Cache menu and catalogue data.
- Load only the current view.
- Use client-side state.
- Add background refresh.
- Use optimistic updates where appropriate.
- Send patches rather than full datasets.
- Add version checks to prevent stale overwrites.
- Generate compact JSON snapshots.
- Precompute reporting summaries.
- Add structured timings and logs.

**Outcome:** Existing apps become faster without requiring a full backend migration.

---

## Stage 6 — FIKA Core Library

Create a reusable Apps Script library for stable shared utilities:

- Validation
- Date and time handling
- Safe JSON parsing
- Standard response objects
- Reference generation
- Logging
- Sheet header lookup
- Row-to-object and object-to-row conversion
- Drive folder resolution
- Email helpers
- Calendar helpers
- PDF helpers
- Quote helpers
- Retry and error handling

Expose larger, meaningful operations where possible instead of many tiny remote calls.

**Outcome:** Common code is maintained once.

---

## Stage 7 — FIKA Core Workflows

Create central business workflows such as:

- `createBooking`
- `updateBooking`
- `confirmBooking`
- `cancelBooking`
- `generateQuote`
- `createCalendarEvent`
- `generateHospitalityBrochure`
- `generatePopupBrochure`
- `createProductionOrder`
- `createDeliveryJob`
- `sendNotifications`
- `writeAuditLog`

Requirements:

- Accept canonical objects.
- Return consistent result objects.
- Support idempotency.
- Avoid duplicate PDFs, events, and emails.
- Produce structured logs.
- Keep implementations in Apps Script initially where practical.

**Outcome:** Apps request business actions rather than recreating them.

---

## Stage 8 — Events Foundation

Treat the Events platform as the first flagship implementation of the new architecture.

Define:

- What counts as an event
- Event types
- Event lifecycle
- Status rules
- Source channels
- Manual event creation
- Venue types
- Labour requirements
- Equipment requirements
- Logistics requirements
- Costing and margin structure
- Quote relationship
- Tasks and responsibilities
- Calendar outputs
- Documents
- Post-event reporting

Public channels remain separate:

- FIKA Events and Pop-ups
- The Line
- Internal, email, and phone enquiries

All channels feed the same internal Events Dashboard.

**Outcome:** A complete event model and workflow exists before the visual build.

---

## Stage 9 — Events Dashboard MVP

Build the internal dashboard first.

Initial capabilities:

- Authentication
- Overview
- Event pipeline
- Calendar
- Event list
- Search and filters
- Manual event creation
- Draft saving
- Event workspace
- Client and venue details
- Timings
- Basic labour, logistics, equipment, and costs
- Tasks
- Notes
- Audit metadata
- JSON-based storage
- Background sync

**Outcome:** Isaias can begin tracking real events in one system.

---

## Stage 10 — FIKA Events and Pop-up Experience

Build a premium public-facing experience using:

- React or Next.js
- Semantic HTML
- High-quality responsive imagery
- Editorial typography
- GSAP or equivalent motion
- Selective Three.js or React Three Fiber enhancements
- Progressive enhancement
- Strong mobile performance
- Accessible forms and navigation
- Structured brochure content
- Progressive enquiry builder

The website should feel cinematic and premium without making the whole product dependent on WebGL.

**Outcome:** FIKA has a flagship visual experience connected to the operational dashboard.

---

## Stage 11 — Connect the Events Workflow

- Public enquiry creates an event draft.
- Manual events use the same canonical schema.
- The Line submissions use the same internal contract.
- Isaias qualifies and enriches events.
- Quotes are generated centrally.
- Labour and equipment are assigned.
- Logistics jobs are created.
- Calendar outputs are created.
- Documents are stored.
- Event status and tasks update consistently.
- Completed events feed reporting.

**Outcome:** Events move through one connected end-to-end workflow.

---

## Stage 12 — Local FIKA MCP Server

Build a local TypeScript MCP server connected to Codex through STDIO.

Start read-only.

Initial tools:

- `list_fika_sites`
- `get_fika_site_config`
- `list_fika_apps`
- `get_app_context`
- `get_schema`
- `list_available_workflows`
- `get_till_migration_status`
- `get_sheet_schema`
- `get_recent_app_errors`

Later additions:

- Google metadata
- Square catalogue metadata
- SumUp or Goodtill metadata
- Migration comparisons
- Repository inspection
- Deployment information

The MCP should return compact, relevant context and never become a raw data dump.

**Outcome:** Codex can retrieve accurate FIKA context without repeated explanation.

---

## Stage 13 — Reusable Codex Skills

Create reusable skills for:

- FIKA UI review
- Apps Script performance audit
- Security and credential audit
- Release checking
- Schema validation
- New-app scaffolding
- Till migration comparison
- Documentation updates
- Event workflow review

**Outcome:** Repeated development work becomes a repeatable command.

---

## Stage 14 — FIKA Starter Application

Create a standard application template with:

- Authentication
- FIKA design tokens
- Responsive layout
- Standard navigation
- Loading, empty, error, and success states
- Apps Script communication helpers
- Client-side caching
- Background refresh
- Structured logging
- Schema types
- `AGENTS.md`
- Build and deployment guidance

**Outcome:** New applications start from a proven base.

---

## Stage 15 — Till Abstraction

Create a provider-independent till layer.

Standard operations:

- `getLocations`
- `getCatalog`
- `getCategories`
- `getSales`
- `getTransactions`

Create adapters for:

- Square
- SumUp
- Goodtill, where relevant

Add tools for:

- Catalogue comparison
- Unmapped items
- Price mismatches
- VAT mismatches
- Category mapping
- Migration status

**Outcome:** Reporting apps stop caring which till provider a site uses.

---

## Stage 16 — Storage Evolution

- Keep Sheets as operational and reporting views where useful.
- Store canonical JSON snapshots.
- Create lightweight indexes.
- Avoid reconstructing objects from many columns.
- Add immutable history where useful.
- Add record versioning.
- Evaluate Drive JSON limits.
- Consider Firestore, Supabase, or PostgreSQL only when measured needs justify them.

**Outcome:** Storage evolves based on evidence rather than fashion.

---

## Stage 17 — Reliability, Security, and Observability

- Centralise error logging.
- Add audit trails.
- Add health checks.
- Add retries.
- Add duplicate-operation protection.
- Move credentials into secure storage.
- Remove secrets from repositories.
- Add permission boundaries.
- Add backup and recovery procedures.
- Add release and rollback processes.
- Document failure behaviour for Google, Square, and SumUp outages.

**Outcome:** The platform becomes safe to rely on across the company.

---

## Stage 18 — Site Provisioning

Build toward a configuration-driven site setup process.

Target flow:

1. Create a site record.
2. Select features.
3. Assign branding.
4. Assign menu.
5. Assign till provider.
6. Assign calendars and Drive locations.
7. Assign permissions.
8. Generate or enable booking platform.
9. Generate or enable dashboard.
10. Connect production, logistics, and reporting.

Long-term target:

> Creating a new site’s standard booking platform and dashboard should approach a 30-second configuration task.

**Outcome:** FIKA growth no longer creates proportional software setup work.

---

## Stage 19 — Remote Backend Decision

Only consider a remote backend or remote MCP when there is a demonstrated need.

Evaluate:

- Apps Script limits
- Number of developers
- Cloud automation requirements
- Shared AI access
- Database requirements
- Reliability needs
- External integrations
- Operational scale

Keep the MCP local if Derek remains the sole developer and local access remains sufficient.

**Outcome:** Infrastructure decisions are evidence-based.

---

# Success Measures

The roadmap is succeeding when:

- New sites require less code than previous sites.
- Core applications share schemas and workflows.
- Slow applications become measurably faster.
- Codex requires less repeated explanation.
- Common functions are maintained once.
- Till migration logic is centralised.
- Events are visible company-wide in one dashboard.
- Public experiences remain brand-specific while sharing internal operations.
- Fewer manual tasks are repeated.
- Fewer errors arise from copied configuration.
- Platform setup becomes configuration-driven.
