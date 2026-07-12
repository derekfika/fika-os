# Historical Plan — Stage 1 Platform Foundations

> **Classification: Historical.** This document preserves the original platform-foundations delivery plan and prompt sequence. Its stage numbering is superseded by the canonical [nine-stage roadmap](roadmap.md) and [Stage 1 — Vision](docs/stages/stage-1-vision.md). The completion evidence remains in [Stage 1 Review](docs/stage-1-review.md).

## Purpose

Create the minimum structure required to begin the wider FIKA platform roadmap safely.

This stage does not rewrite production applications.

It creates:

- A clear scope
- A central specifications repository
- A documented application inventory
- A current-state system map
- A list of duplicated functions
- A list of performance problems
- Initial repository standards
- The first `AGENTS.md`
- A prioritised starting point

---

## Stage 1 Outcome

Stage 1 is complete when:

- The FIKA platform boundary is documented.
- Bloom and HomeBuck are explicitly excluded.
- The `fika-platform-specs` repository exists.
- Every active core FIKA operational app is listed.
- Major data sources and integrations are recorded.
- Repeated functions are identified.
- Slow or fragile applications are identified.
- The first three priorities are chosen.
- The current platform can be explained on one page.
- No production behaviour has been changed.

---

# Part 1 — Create the Central Repository

Create a private GitHub repository named:

```text
fika-platform-specs
```

Clone it locally to:

```text
C:\FIKA\fika-platform-specs
```

Recommended initial structure:

```text
fika-platform-specs/
├── AGENTS.md
├── README.md
├── roadmap.md
├── stage1.md
├── docs/
│   ├── scope.md
│   ├── current-system-map.md
│   ├── target-architecture.md
│   └── decisions/
├── inventory/
│   ├── applications.md
│   ├── data-sources.md
│   ├── integrations.md
│   ├── shared-functions.md
│   ├── performance-issues.md
│   └── priorities.md
├── schemas/
├── fixtures/
└── config-examples/
```

Do not add:

- API tokens
- OAuth credentials
- Service account keys
- Private certificates
- Passwords
- Production secrets

---

# Part 2 — Define Scope

Create `docs/scope.md`.

It should state that the main FIKA platform includes:

- Hospitality booking platforms
- Hospitality dashboards
- CPU production
- Logistics
- Events dashboard
- FIKA Events and Pop-ups
- The Line feed into the Events Dashboard
- Quotes
- PDFs and brochures
- Calendar creation
- Gmail and Drive workflows
- BrightHR employee data
- Menus and brochure content
- Site configuration
- Till integrations
- Reporting
- Shared utilities, schemas, and workflows

It should explicitly exclude:

- Bloom
- HomeBuck
- Personal projects
- Unrelated experiments

---

# Part 3 — Create the Application Inventory

Create `inventory/applications.md`.

Use a Markdown table with these columns:

| Field | Description |
|---|---|
| App ID | Stable lowercase ID |
| App name | Human-readable name |
| Status | Live, Pilot, Development, Paused, Obsolete |
| Purpose | Business problem solved |
| Users | Who uses it |
| Site or scope | Site-specific or company-wide |
| Repository | Local or GitHub location |
| Apps Script project | Project name or link |
| Deployment | Production URL |
| Frontend | Apps Script HTML, React, Android, etc. |
| Data source | Sheets, Drive JSON, API, etc. |
| Connected apps | Systems it sends to or receives from |
| Criticality | Low, Medium, High, Critical |
| Health | Good, Needs work, Fragile |
| Notes | Important context |

Start with the known core estate:

- Hospitality booking platforms
- Hospitality dashboard
- CPU production dashboard
- Logistics dashboard or plan
- Events dashboard
- FIKA Events and Pop-ups platform
- The Line integration
- Quote-generation tools
- Kitchen-order and printer workflows
- Hospitality brochure or menu tools
- BrightHR employee workflows
- Workforce operations platform
- Munich RE hot-drinks tools, if still considered core operational reporting
- MNK grab-and-go and catalogue tools
- Square catalogue and sales tools
- SumUp or Goodtill migration tools
- Any other active FIKA operational application

Do not include Bloom or HomeBuck.

---

# Part 4 — Create the Data Source Inventory

Create `inventory/data-sources.md`.

Use these fields:

| Field | Description |
|---|---|
| Data source ID | Stable ID |
| Name | Human-readable name |
| Type | Sheet, Drive folder, Calendar, JSON, API |
| Used by | App IDs |
| Purpose | What it stores |
| Identifier location | Where the ID is stored |
| Hardcoded | Yes or No |
| Approximate size | Rows, files, or records |
| Read frequency | Startup, every click, hourly, daily |
| Write frequency | High, Medium, Low |
| Source of truth | Yes, No, Partial |
| Notes | Known problems |

Important questions:

- Does an app scan entire Sheets on startup?
- Does it search Drive by filename?
- Are folder IDs stored?
- Is the same information duplicated across Sheets?
- Are objects reconstructed from multiple tabs?
- Does another app depend on exact column positions?
- Is a Sheet acting as data store, report, admin surface, or all three?

---

# Part 5 — Create the Integration Inventory

Create `inventory/integrations.md`.

Use these fields:

| Field | Description |
|---|---|
| Integration ID | Stable ID |
| Provider | Google, Square, SumUp, Goodtill, BrightHR, Gmail, Calendar |
| Used by | App IDs |
| Purpose | What it does |
| Read or write | Read, Write, Both |
| Authentication location | Script properties, OAuth, local env, etc. |
| Current provider | Useful during migration |
| Target provider | Future provider |
| Migration status | Not started, Planning, Testing, Complete |
| Risk | Low, Medium, High |
| Notes | Limits and issues |

Never record actual secrets.

Record only where they are stored.

---

# Part 6 — Identify Shared Functions

Create `inventory/shared-functions.md`.

Group repeated functions under:

## Configuration

- Site settings
- Sheet IDs
- Folder IDs
- Calendar IDs
- Email recipients
- Till provider
- Location mappings

## Booking

- Validation
- Booking ID generation
- Status changes
- Date parsing
- Customer normalisation
- Item normalisation

## Quotes and Documents

- Quote numbering
- Pricing
- VAT
- Template replacement
- PDF generation
- File naming
- Drive saving

## Calendar

- Event title
- Event description
- Event lookup
- Event creation
- Event update
- Event cancellation

## Email

- Confirmations
- Cancellations
- Operational notifications
- Attachments
- HTML templates

## Drive

- Folder lookup
- Folder creation
- File search
- File conversion
- Archive behaviour

## Sheets

- Header lookup
- Row-to-object conversion
- Object-to-row conversion
- Append or update
- Schema validation
- Batch reads and writes

## Logging

- Error logs
- Audit logs
- Scan logs
- User action logs

## External Providers

- Square API calls
- SumUp or Goodtill calls
- BrightHR calls
- Pagination
- Retry handling
- Catalogue mapping
- Sales retrieval

For each repeated function, record:

| Field | Description |
|---|---|
| Category | Quote, Calendar, PDF, etc. |
| Function name | Current name |
| App ID | Where it appears |
| Purpose | What it does |
| Duplicate | Yes or No |
| Variations | How versions differ |
| FIKA Core candidate | Yes, Maybe, No |
| Centralisation risk | Low, Medium, High |
| Notes | Bugs or inconsistencies |

Do not centralise anything yet.

---

# Part 7 — Record Performance Problems

Create `inventory/performance-issues.md`.

Use:

| Field | Description |
|---|---|
| App ID | Affected app |
| Screen or function | Where the delay occurs |
| Symptom | Blank screen, slow table, timeout |
| Approximate delay | Seconds |
| Suspected cause | Sheet scan, Drive search, API call |
| Calls made | If known |
| Dataset size | Rows or files |
| Frequency | Every load, sometimes, reports only |
| Business impact | Low, Medium, High |
| Quick fix | Yes, Maybe, No |
| Notes | Extra context |

Initial measurement can be simple:

- Use a stopwatch.
- Record first load.
- Record second load.
- Record filter changes.
- Record report generation.
- Record save operations.

Look for:

- Entire Sheet reads
- Cell-by-cell calls
- Reads inside loops
- Repeated Drive searches
- Repeated API calls
- Loading all history
- Too many `google.script.run` calls
- Rebuilding the same objects repeatedly
- Reports calculated on demand from raw data

---

# Part 8 — Create Priorities

Create `inventory/priorities.md`.

Score each active app from 1 to 5 for:

- Business value
- Number of users
- Performance pain
- Fragility
- Duplication
- SumUp migration relevance
- Events platform relevance
- Ease of improvement

Suggested calculation:

```text
Priority Score =
Business Value
+ Number of Users
+ Performance Pain
+ Fragility
+ Duplication
+ Migration Relevance
+ Events Relevance
+ Ease of Improvement
```

Select:

- Top three applications
- Top three shared functions
- Top three performance issues
- Top three schemas to define first

Likely first schemas:

1. `FikaSite`
2. `FikaEvent`
3. `FikaBooking`

This may change after the inventory.

---

# Part 9 — Create the Current System Map

Create `docs/current-system-map.md`.

The first version can be Mermaid.

Include:

- Public booking forms
- Hospitality dashboards
- Events dashboard
- CPU production
- Logistics
- Quote generation
- Calendar
- Gmail
- Drive
- Sheets
- Square
- SumUp or Goodtill
- BrightHR
- Reporting

Use arrows to show:

- Where data originates
- Where data is transformed
- Where data is duplicated
- Where manual intervention happens
- Which systems are source-of-truth
- Which systems are views only

Keep the first diagram simple.

---

# Part 10 — Create the First Global AGENTS.md

Create `AGENTS.md` in the specs repository.

Suggested content:

```md
# FIKA Platform Working Instructions

## Purpose

This repository is the architectural source of truth for the FIKA operational platform.

## Scope

Include core FIKA operational systems only.

Exclude Bloom, HomeBuck, personal projects, and unrelated experiments.

## Working Rules

- Inspect existing documentation before making changes.
- Preserve established terminology unless a change is explicitly documented.
- Do not invent site IDs, system IDs, schemas, or production behaviour.
- Do not include credentials or private secrets.
- Prefer configuration over hardcoded assumptions.
- Prefer canonical schemas over spreadsheet-specific logic.
- Prefer gradual migration over full rewrites.
- Record architectural decisions in `docs/decisions`.
- Update related documentation when changing a schema or workflow.
- Mark assumptions clearly.
- Do not alter production repositories from this specs repository.

## Schema Rules

- All schemas must be versioned.
- Use stable IDs.
- Use ISO 8601 timestamps.
- Define required and optional fields.
- Include validation rules.
- Include at least one valid fixture.
- Define ownership and source-of-truth.
- Avoid embedding provider-specific details into canonical objects unless required.

## Completion Requirements

Before finishing a task:

1. Review affected files.
2. Check links and terminology.
3. Ensure no secrets were introduced.
4. Ensure scope boundaries remain intact.
5. Summarise changes.
6. List unresolved decisions.
```

---

# Part 11 — Stage 1 Deliverables

Stage 1 should produce:

- `README.md`
- `roadmap.md`
- `stage1.md`
- `AGENTS.md`
- `docs/scope.md`
- `docs/current-system-map.md`
- `inventory/applications.md`
- `inventory/data-sources.md`
- `inventory/integrations.md`
- `inventory/shared-functions.md`
- `inventory/performance-issues.md`
- `inventory/priorities.md`

Optional:

- Initial Mermaid diagrams
- A decision log
- A list of candidate repositories to inspect next

---

# What Not to Do

During Stage 1:

- Do not refactor production code.
- Do not build the MCP server.
- Do not create the shared Apps Script library.
- Do not introduce a database.
- Do not move credentials.
- Do not redesign applications.
- Do not define every schema in full.
- Do not attempt to document every function.
- Do not let the inventory become endless.

The goal is enough clarity to start the next stage safely.

---

# Recommended Codex Prompt Sequence

Do not give Codex one giant prompt for all of Stage 1.

Use small, reviewable prompts.

## Prompt 1 — Repository Setup

```text
Read roadmap.md and stage1.md fully.

Create the Stage 1 repository structure described in stage1.md.

Do not invent production information.
Do not modify any production application repositories.
Create placeholder Markdown files with clear headings and TODO markers where factual input is still required.

Also create the initial AGENTS.md using the requirements in stage1.md.

When complete:
- show the created file tree;
- summarise what was added;
- list every item that still requires factual input from me.
```

## Prompt 2 — Scope

```text
Read AGENTS.md, roadmap.md, and stage1.md.

Complete docs/scope.md using only the confirmed scope in these files.

Core FIKA operational systems are in scope.
Bloom, HomeBuck, personal projects, and unrelated experiments are out of scope.

Do not add speculative systems.
List any ambiguous boundary decisions separately at the end.
```

## Prompt 3 — Initial Application Inventory

```text
Read the repository documentation.

Populate inventory/applications.md with only applications that can be identified from the local repositories and existing documentation.

Do not guess missing deployment URLs, IDs, owners, or statuses.
Use TODO for missing values.

Exclude Bloom and HomeBuck.

At the end:
- list applications found;
- list likely duplicates;
- list applications that require manual confirmation.
```

## Prompt 4 — Repository Scan

Run this separately against each important app repository.

```text
Inspect this repository without editing production code.

Produce a report covering:
- purpose;
- users;
- deployment type;
- data sources;
- external integrations;
- hardcoded configuration;
- repeated utility functions;
- likely performance bottlenecks;
- relationship to other FIKA applications;
- risks;
- missing documentation.

Return the findings in a structured Markdown format suitable for copying into the fika-platform-specs inventory.

Do not refactor or modify files.
Do not reveal credentials.
```

## Prompt 5 — Shared Function Analysis

```text
Using the completed repository reports, update inventory/shared-functions.md.

Group duplicated functions into:
- configuration;
- booking;
- quote and documents;
- calendar;
- email;
- Drive;
- Sheets;
- logging;
- external providers.

Identify:
- exact duplicates;
- similar implementations;
- likely FIKA Core candidates;
- functions that are too app-specific to centralise;
- centralisation risks.

Do not move or change any code.
```

## Prompt 6 — Performance Inventory

```text
Review the repository reports and update inventory/performance-issues.md.

Focus on:
- full Sheet scans;
- cell-by-cell reads and writes;
- Drive searches;
- repeated API calls;
- excessive google.script.run calls;
- loading too much data at startup;
- repeated object reconstruction;
- missing caching;
- reports calculated from raw data on every request.

Separate confirmed findings from suspected findings.
Do not propose a rewrite yet.
```

## Prompt 7 — System Map

```text
Using the completed inventory files, create docs/current-system-map.md.

Include:
- a plain-English overview;
- a Mermaid diagram;
- data origin points;
- downstream consumers;
- manual handoffs;
- duplicated data;
- current sources of truth;
- uncertain relationships marked clearly.

Do not invent integrations.
```

## Prompt 8 — Prioritisation

```text
Review all Stage 1 inventory and documentation.

Update inventory/priorities.md.

Score active applications using the Stage 1 scoring criteria.
Explain each score briefly.

Recommend:
- the first three applications to address;
- the first three repeated functions to centralise;
- the first three performance problems to investigate;
- the first three schemas to define.

Do not begin implementation.
```

## Prompt 9 — Stage 1 Review

```text
Perform a Stage 1 completion review against stage1.md.

Check:
- required files;
- scope boundaries;
- application coverage;
- data-source coverage;
- integration coverage;
- shared-function coverage;
- performance coverage;
- priorities;
- current system map;
- unresolved decisions;
- accidental secrets.

Do not modify production repositories.

Fix minor documentation gaps.
For anything requiring business knowledge, create a clear question in a final unresolved-decisions section.
```

---

# Best Prompting Pattern

For each Codex task:

1. Ask it to read `AGENTS.md`.
2. Name the exact files it may edit.
3. State what it must not do.
4. Ask for inspection before implementation.
5. Require TODO markers instead of guesses.
6. Require a summary of changes.
7. Require unresolved decisions.
8. Review the diff before moving on.

Avoid:

- One prompt covering an entire roadmap stage.
- Asking Codex to inspect and refactor simultaneously.
- Letting it guess production configuration.
- Allowing silent changes across many repositories.
- Mixing documentation, architecture, UX, and implementation in one task.
