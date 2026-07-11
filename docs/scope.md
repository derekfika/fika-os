# FIKA Platform Scope

## Purpose

The FIKA platform covers the core operational systems, shared capabilities, and supporting tooling needed to run and grow FIKA without multiplying manual work, duplicated code, or site-specific setup.

This document defines the platform boundary. It does not confirm that a particular application is live, identify deployments or system IDs, or define unverified integrations. Those facts belong in the Stage 1 inventories.

## In Scope

### Hospitality and Site Operations

- Core FIKA hospitality booking platforms
- Hospitality dashboards
- CPU production workflows
- Logistics workflows
- Hospitality menu and brochure data
- Site configuration
- Operational reporting

### Events

- The company-wide Events Dashboard
- FIKA Events and Pop-ups public platform
- The Line as a separate client-facing experience that feeds the shared Events Dashboard
- Pop-up brochure backend and data
- Events originating from FIKA sites, external venues, email, phone, and manual creation

### Documents and Communications

- Quote generation
- PDF and brochure generation
- Calendar event creation
- Gmail and Drive workflows

### People and Till Workflows

- BrightHR employee data workflows
- Square-to-SumUp or Goodtill migration tooling

### Shared Platform Capabilities

- Shared schemas
- Shared utilities
- Shared configuration
- Shared workflows
- Local Codex MCP tooling

## Events Platform Boundary

The Events Dashboard is the internal, company-wide source of truth for events. It receives or records events from:

- The Line
- FIKA sites
- FIKA Events and Pop-ups
- External venues
- Email
- Phone
- Manual event creation

The Line and FIKA Events and Pop-ups remain separate client-facing experiences. They share the internal Events Dashboard rather than becoming the same public application.

The precise event lifecycle, source contracts, data ownership before an event reaches the dashboard, and implementation details remain to be defined in later Events stages.

## Out of Scope

- Bloom applications
- HomeBuck
- Personal projects
- Unrelated experiments

Bloom remains architecturally separate from the main FIKA platform.

## Boundary Principles

- Include core FIKA operational systems only.
- Public experiences may remain brand-specific while sharing internal operations.
- Prefer configuration, canonical schemas, and shared workflows over duplicated site-specific logic.
- Treat Sheets as potential operational, reporting, or administrative surfaces; do not assume that every Sheet is the sole source of truth.
- Keep credentials and production secrets outside repositories.
- Do not infer scope membership merely because code exists in the current repository.

## Ambiguous Scope Questions

- Does Munich RE hot-drinks reporting remain part of core FIKA operational reporting?
- Are there workforce operations tools beyond the confirmed BrightHR employee data workflows that should be inside the platform boundary?
- Are there operational tools in the current repository that are obsolete, paused, experimental, or otherwise outside the core estate despite their location?

## Resolve During Application Inventory

The following are inventory facts rather than scope decisions:

- The exact list of active applications within each in-scope category
- Application names, stable app IDs, statuses, users, sites, owners, and business criticality
- Repository and Apps Script project locations
- Production deployments and URLs
- Data sources, sources of truth, and duplicated data
- Confirmed connections between applications
- Sheet, Drive folder, Calendar, and API identifiers and where those identifiers are stored
- Current authentication-storage locations, without recording secrets
- Whether SumUp, Goodtill, or both apply to each till migration workflow
- Performance, fragility, hardcoded configuration, and duplicated functions
- Which existing tools are active, paused, obsolete, or candidates for archival
