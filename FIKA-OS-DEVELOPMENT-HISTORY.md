# FIKA OS — Development History

**Reconstructed through:** 23 August 2026  
**Repository:** `derekfika/fika-os`  
**Status:** Living history / reconstructed timeline

> This file is reconstructed from ChatGPT conversation history, GitHub repository metadata, known commits/checkpoints and project notes. Dates are well supported; hours are estimates rather than timesheet-grade records.

---

## Executive summary

FIKA OS was **explicitly conceptualised on 10 July 2026**.

At **17:31 UTC**, the conversation turned directly to:

> “Okay so let's think about FIKA OS. What if we had a customised home page for each customer, effectively a simple CRM?”

Within the same evening, the idea had already grown beyond a CRM into a broader operating platform: shared functions, configuration, integrations, bookings, deployments, reporting and AI tooling, with versioned canonical business objects as the common language between applications.

The private GitHub repository was created on **11 July 2026 at 18:48 UTC**. Over 11–15 July the project moved quickly into business discovery, OPLOC, operational capabilities, mobilisation, canonical schemas, governed authority and the principle that business decisions should precede implementation.

By **15 July**, one of the defining architectural rules was explicit:

> **FIKA OS is a platform, not a destructive rewrite.**

Stable legacy workflows should remain live until their replacements are proven, understood and accepted.

By **22 July**, the repository was formally positioned as `derekfika/fika-os`, with the milestone commit:

`df85c68 — Initial FIKA OS platform`

Late July established the **Integration Hub** as the platform spine and a local-first Firebase Emulator strategy. August then shifted heavily into operational software: Hospitality, canonical Production Orders, CPU Production, allergens, Menu Planning, Delivered-In, Grab & Go and Logistics.

The most intense sprint was **18–23 August**, when the project moved into CPU-launch readiness, realistic UAT data, end-to-end workflow testing, visual refactors and high-performance change-stack/read-projection architecture.

### Estimated effort to 23 August 2026

- **Documentable lower bound:** ~70 active hours
- **Likely hands-on design / implementation / review / testing:** **~80–100 hours**
- **Reasonable headline estimate:** **~90 hours**
- **Including long Codex implementation runs, builds, test cycles and asynchronous agent work:** approximately **110–140+ hours of development activity**

---

# Timeline

## 10 July 2026 — The idea becomes FIKA OS

Earlier work was still centred on individual FIKA tools such as Hospitality booking and feedback workflows.

At **17:31 UTC**, FIKA OS was explicitly named and discussed as a customised customer homepage / simple CRM concept.

By roughly **19:06–19:37 UTC**, the thinking already included:

- shared FIKA functions;
- configuration;
- integrations;
- bookings;
- deployments;
- reporting;
- AI tooling;
- versioned canonical booking objects;
- downstream applications consuming the same canonical object;
- reducing spreadsheet reconstruction;
- Sheets acting as reporting/audit projections rather than the primary live application database.

This is the clearest point to call the **conceptual birth of FIKA OS**.

**Estimated FIKA OS work:** ~2–3 h.

---

## 11 July — From concept to business discovery

GitHub repository created:

`2026-07-11T18:48:52Z`

MNK mobilisation became a useful live discovery case. Important ideas included:

- direct booking-platform JSON;
- one canonical booking object regardless of ingestion channel;
- OPLOC as durable operational-location identity;
- service points and operational capabilities;
- a `CPU_CREATED` workflow boundary;
- dynamic services;
- role-based access;
- mobilisation as a proper business domain;
- retaining Angel Court's legacy inbox fallback while newer flows moved toward canonical ingestion.

**Estimated work:** ~2–4 h.

---

## 12 July — Cohesion and governance

FIKA OS Cohesion Principles were being defined, including:

- safe, non-destructive automation;
- business decisions before schemas;
- preserved history;
- explicit relationships;
- governed authority;
- separation of business ownership from technical administration;
- **“Build for tomorrow's FIKA.”**

Repository material from this period also records formal decisions around operational capability, configuration and authority.

**Estimated work:** ~2–4 h.

---

## 13 July — Domain programmes and governed canon

Pack-based governed refinement was underway.

Work included:

- Business Decision Records;
- canonical decisions;
- schema generation;
- traceability;
- valid/invalid fixtures;
- Domain Programmes;
- domain definitions;
- staged **Alpha → Beta → RC → Production** progression;
- destructive testing;
- reset/scenario packs;
- dependency-directed parallel domain development.

FIKA OS now had a repeatable method for defining business meaning before coding against it.

**Estimated work:** ~4–6 h.

---

## 15 July — “Platform, not rewrite”

The coexistence principle became explicit:

- do not overwrite stable legacy workflows;
- build new domains alongside them;
- integrate legacy systems;
- prove replacement workflows;
- retire legacy deliberately after acceptance.

Canonical domains already being discussed included Hospitality, Production/CPU, Learning/Aspire, Food Information, Reporting, Improvement and operational configuration/governance.

**Estimated work:** ~1–2 h.

---

## 22 July — The repository becomes recognisably FIKA OS

The private repository was formally positioned as:

`derekfika/fika-os`

Milestone commit:

`df85c68 — Initial FIKA OS platform`

The repo was becoming a monorepo for applications, dashboards, portals, specifications and shared platform material.

Repository description:

> “A design philosophy for all FIKA apps with the end goal of a complete FIKA OS”

**Estimated work:** ~1–2 h.

---

## 27–29 July — Integration Hub becomes the platform spine

A Data Ingestor concept evolved into the **FIKA OS Integration Hub**, increasingly responsible for:

- external integration boundaries;
- canonical schemas;
- staged ingestion;
- provenance;
- promotion controls;
- canonical business records;
- validation and governance.

A substantial documented session on **27 July** ran for roughly **6½ hours**.

On **28 July**, the architecture explicitly adopted **local-first Firebase Emulator development** so architecture and workflows could be proven locally before production promotion.

OPLOC was also corrected away from invented location hierarchies:

- OPLOC = durable canonical location identity;
- Site/Venue are classifications/types rather than competing identities;
- operational functions remain separate from location identity.

By **29 July**, the roadmap placed the Integration Hub as the platform spine, followed by shared identity/reference data and gradual operational-domain migration using adapters, shadow mode, crosswalks, parallel operation and controlled cutover.

**Estimated work across 27–29 July:** ~10–14 h.

---

# August — Platform architecture becomes operational software

## 1 August — CPU workflow becomes concrete

A long CPU-focused session ran approximately **05:29–12:40 UTC**.

The governed flow was already becoming clear:

`Hospitality → Production Order → CPU/Liana → planning → allergen checker → Planned → downstream notification/menu generation`

Work included:

- Monday–Friday CPU calendar;
- daily totals;
- full-screen planning;
- menu item → sub-item hierarchy;
- allergen matrix interaction;
- partial-plan save/reload;
- CPU workflow states;
- identifying the split between canonical Production Orders and temporary ProductionPlan state;
- local-safe dates;
- durable-plan requirements.

CPU was becoming a true operational application rather than only an aggregation dashboard.

**Estimated work:** ~7 h.

---

## Early–mid August — Filling out the operating system

Development continued across combinations of:

- CPU Production;
- Hospitality Booking;
- canonical Production Orders;
- allergens;
- menu generation;
- Grab & Go;
- Beverage Innovation;
- shared contracts;
- operational reporting and presentation rules.

This period was less concentrated than the later launch sprint but established many components later joined end to end.

**Estimated work:** ~10–15 h.

---

# 18–23 August — CPU launch sprint

The practical target increasingly became a **controlled CPU launch at the start of September**, rather than finishing every theoretical FIKA OS domain first.

## 18 August — Menu Planning becomes operational

Historical Menu Planning import recognised:

- **15 weekly workbooks**;
- **15 weeks**;
- **809 entries**;
- **82 entries for WC 17/08/2026**.

The model separated historical truth, reusable MenuItems, MenuPlanEntries, destination quantities, explicit allergen evidence and publication state.

Critical rule:

> **Never infer allergens from ingredients.**

The UI moved toward Brian's actual weekly workflow:

`current week → copy/roll → swap dishes → portions by destination → allergens → publish`

**Estimated work:** ~6–8 h.

---

## 19 August — Delivered-In and Logistics

Delivered-In Phase 1 included authenticated access, Today/This Week/Allergens, publication projection, OPLOC filtering, site quantities, signed allergen checking and provenance.

The codebase was noted as approximately **125,000 source LOC across 630 files**, excluding Markdown.

Later that day Logistics became the next domain. Required inputs included:

- Delivered-In lunches;
- Grab & Go;
- sandwich lunches;
- Hospitality;
- manual collections;
- deliveries;
- site transfers.

The model evolved around:

`FulfilmentRequirement → LogisticsJob → DeliveryLoad → run / driver`

with OPLOC-based consolidation instead of display-text matching.

**Estimated work:** ~7–9 h.

---

## 20 August — CPU cleanup and realistic UAT data

False/placeholder CPU dashboard information was removed.

Attention moved to populating realistic future production across Hospitality, sandwich lunches, Delivered-In and Grab & Go, then checking whether that work appeared correctly downstream.

This immediately exposed genuine integration holes, including production visible in one view/domain but missing from another.

This was an important transition from:

> “Does the screen work?”

into:

> **“Does the business lifecycle work?”**

**Estimated work:** ~5–7 h.

---

## 21 August — Visual refactors + launch/UAT framework

### Logistics

The operational UX was refactored for desktop planning and portrait/mobile driver use. Mobile presentation was simplified around deliveries and collections rather than unnecessary run labels.

### CPU

The CPU dashboard received a substantial desktop visual refactor, followed by work on Menu Planner, Delivered-In and clearer allergen presentation.

Delivered-In received its own complete allergen matrix. Grab & Go remained self-labelled and did not need CPU allergen checking.

### UAT

A comprehensive launch/UAT tracker was created with:

- **322 test cases**;
- **146 P0 launch-critical tests**;
- **20 manual end-to-end journeys**;
- **55 launch gates**.

Testing loop:

`test → log defect → Codex fix → retest → reassess readiness`

**Estimated work:** ~8–10 h.

---

## 22 August — UAT fixes and operational polishing

Hospitality workflow fixes included:

- “One last look” review;
- portal consistency;
- pax/date context;
- minimum quantities;
- Sending feedback;
- stale quote detection/regeneration;
- PDF quotes to Drive;
- delivery-charge preservation;
- direct CPU handoff;
- manager allergen refresh;
- planning/signature improvements;
- immutable pricing preservation.

The development rhythm shifted toward small UAT findings fixed one by one.

**Estimated work:** ~4–6 h.

---

## 23 August — Change stacks and operational read projections

Logistics performance problems exposed a deeper architectural issue: operational dashboards should not rebuild their full state from several domains every time they open.

A lightweight change-stack + projection pattern emerged.

### Logistics

`canonical Logistics state → LogisticsChangeEvent → LogisticsDayProjection → dashboard`

Implemented/hardened areas included:

- append-only changes;
- cursor/revision;
- cached projections;
- incremental sync;
- deterministic rebuild/reconciliation;
- parity diagnostics;
- week/day navigation;
- queue and timeline;
- collection lane;
- drag/drop;
- DeliveryLoad consolidation;
- driver view.

A projection migration briefly caused a visible regression because existing UAT fulfilment work had never been reconciled into canonical LogisticsJobs. The old UX was restored over the new projection architecture rather than throwing away the change stack.

Known commits:

- `fae7883` — Restore projection-backed Logistics dashboard
- `a2f8bb9` — Harden Logistics and add CPU projections
- `a6f35fb` — Harden CPU and Logistics projections

### CPU

The pattern was then applied more carefully:

`ProductionOrder + ProductionPlan → CPU changes → day/week projections → CPU dashboard`

Final hardening included:

- week-scoped projections instead of an unbounded “all” projection;
- day/week refresh after changes;
- `changesSince`;
- authenticated projection APIs;
- canonical reload before editing;
- server-owned audit identity;
- durable ProductionPlan direction;
- CPU parity diagnostics;
- Logistics assignment-date repair tooling.

End-of-pass validation:

- **57 CPU tests passed**;
- **43 Logistics tests passed**;
- CPU and Logistics typechecks passed;
- CPU and Logistics production builds passed;
- browser Week/Day/Queue checks passed;
- populated Logistics day checked.

**Estimated work by ~16:00 local:** ~4–6 h.

---

# Estimated working time

| Period | Reconstructed active time |
|---|---:|
| 10–15 Jul — concept, discovery, canon, governance | 11–17 h |
| 16–31 Jul — repo/platform consolidation, Integration Hub, OPLOC, migration architecture | 16–23 h |
| 1–17 Aug — CPU/Hospitality and supporting domains | 17–24 h |
| 18 Aug | 6–8 h |
| 19 Aug | 7–9 h |
| 20 Aug | 5–7 h |
| 21 Aug | 8–10 h |
| 22 Aug | 4–6 h |
| 23 Aug to ~16:00 | 4–6 h |
| **Likely reconstructed total** | **78–110 h** |

## Recommended headline

A fair informal answer is:

> **“Roughly 90 hours of hands-on work over about six weeks, plus a lot of unattended agent/build time.”**

A conservative professional version:

> **“Approximately 80–100 hours of active design, implementation, review and testing by 23 August 2026.”**

Including long Codex runs, build/test cycles and asynchronous agent activity, total engineering activity represented is plausibly **110–140+ hours**.

---

# Major architectural milestones

1. **Canonical language rather than spreadsheet reconstruction**
2. **Platform, not rewrite**
3. **Business decisions before schemas**
4. **Integration Hub as platform spine**
5. **OPLOC as durable operational identity**
6. **Production Order as governed handoff**
7. **CPU as an operational application**
8. **Menu Planning as weekly operational planning**
9. **Delivered-In as its own production lane**
10. **LogisticsJob → DeliveryLoad**
11. **Change stacks + operational projections**
12. **UAT-driven development**

---

# Git evidence

## Repository

- **Repository:** `derekfika/fika-os`
- **Visibility:** Private
- **Created:** `2026-07-11T18:48:52Z`
- **Description:** “A design philosophy for all FIKA apps with the end goal of a complete FIKA OS”

## Known milestone commits

- `df85c68` — Initial FIKA OS platform
- `fae7883` — Restore projection-backed Logistics dashboard
- `a2f8bb9` — Harden Logistics and add CPU projections
- `a6f35fb` — Harden CPU and Logistics projections

## Known checkpoint branches

- `checkpoint/2026-08-18-fika-os`
- `checkpoint/2026-08-18-platform-specs`
- `checkpoint/2026-08-21-cpu-production-green`

---

# What FIKA OS had become by 23 August

In roughly six weeks, the project had evolved from a customer-homepage/CRM idea into a multi-domain operational platform containing or actively integrating:

- Integration Hub;
- canonical contracts;
- AUTHMOD / role-based governance concepts;
- OPLOC;
- Hospitality Booking portals and manager dashboards;
- quote and Drive workflows;
- canonical Production Orders;
- CPU Production;
- allergen planning and sign-off;
- Menu Planning;
- Delivered-In;
- Grab & Go integration;
- sandwich production;
- Logistics;
- DeliveryLoads and driver workflow;
- change stacks/read projections;
- UAT and launch-readiness governance;
- shared contracts/utilities;
- legacy tools being absorbed gradually rather than abruptly replaced.

The project was deliberately **not finished** at this point.

The emphasis had shifted to:

> **prove the real end-to-end business lifecycle through UAT, then fix what reality exposes.**

---

# Next chapter

The next phase is systematic UAT of real journeys such as:

`Hospitality booking → manager review → Production Order → CPU planning → allergen sign-off → production ready → Logistics → completion`

followed by amendments, cancellations, duplicate handoffs, restarts, missing data and failure states.

The same should be repeated for:

- sandwich lunches;
- Delivered-In;
- Grab & Go;
- CPU-created work.

The goal is to distinguish business-workflow defects from projection/read-model, data-quality, permissions and UI defects.

---

# Accuracy note

This is intentionally a **reconstructed** history rather than an exact timesheet.

The hour estimate is uncertain because conversation gaps, parallel Codex work, unattended runs, builds and review periods are not consistently timestamped.

The safest headline is therefore:

> **FIKA OS was explicitly conceptualised on 10 July 2026 and had accumulated roughly 80–100 hours of hands-on design/development/testing by 23 August 2026.**
