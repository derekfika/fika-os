# Future Platform Domains

> **Classification: Supporting future-domain evidence.** This is not a commitment, roadmap or adopted domain catalogue. Approved decisions and BDRs take precedence where discovery has since resolved a candidate.

## Purpose

This document records business domains that may eventually become first-class FIKA Platform capabilities. It is an architectural horizon: it is not a roadmap, backlog, commitment, delivery sequence, or assertion that an application exists.

Entries should influence boundaries, identifiers, configuration, permissions, audit, and interoperability without forcing premature schemas or implementations.

## Reusable domain template

### Domain name

- **Classification:** Future domain; not a committed implementation
- **Purpose:** TODO
- **Business Owner:** Events Lead, with Site Manager approval where appropriate
- **Problem being solved:** TODO
- **Candidate schemas:** TODO; names are provisional until discovery
- **Candidate workflows:** TODO
- **Dependencies:** TODO
- **Current maturity:** Concept / evidence gathering / existing fragmented capability / TODO
- **Notes:** Record confirmed context, boundaries, and questions. Do not select technology or storage here.

## Events

- **Classification:** Future domain; planned capability, not a committed implementation
- **Purpose:** Provide a shared company-wide event model and internal operational source of truth while supporting distinct public/client experiences.
- **Business Owner:** TODO
- **Problem being solved:** Events originate from The Line, FIKA sites, FIKA Events and Pop-ups, external venues, and email, phone, or manual entry. Separate channels must not create separate operational truths.
- **Candidate schemas:** `FikaEvent`, event source/reference, Operational Location, Client/Client Contact, schedule, event status and workflow state. Names remain provisional until Stage 5.
- **Candidate workflows:** capture/normalise event; deduplicate; amend/cancel; assign ownership; operational review; publish/project to authorised experiences; reporting.
- **Dependencies:** site/configuration, customer/contact, permissions, notifications, Calendar adapter, audit, document/media references.
- **Current maturity:** Event definition, Service/Booking boundary and approval direction are canonical; no repository or adopted schema exists.
- **Notes:** The internal Events Dashboard is the intended company-wide operational view of authoritative Event records; the governed Event domain remains the canonical owner. The Line and FIKA Events and Pop-ups remain separate experiences feeding it. Do not assume a hospitality booking is an Event or that statuses are identical.

## Media Management

- **Classification:** Future domain; not a committed implementation
- **Purpose:** Govern reusable business media and its authorised use across public, client-facing, document, and internal experiences.
- **Business Owner:** TODO
- **Problem being solved:** Current applications use generated documents, PDFs, branding assets and operational photographs, but a shared media lifecycle, ownership and retention model has not been established.
- **Candidate schemas:** media asset, rendition, usage/reference, ownership, consent/licence, retention classification. TODO.
- **Candidate workflows:** upload/import; validate; approve; transform; publish/reference; replace; archive/retain; permission review.
- **Dependencies:** brand system, files repository interface, permissions, audit, Events/Documents/Equipment where applicable.
- **Current maturity:** Fragmented evidence only; no first-class domain confirmed.
- **Notes:** CPU preparation/allergen photographs are operational evidence and may require a distinct evidence/retention policy rather than general marketing media treatment.

## Equipment Management

- **Classification:** Future domain; not a committed implementation
- **Purpose:** Represent equipment required, available, allocated, moved, maintained, or returned for FIKA operations.
- **Business Owner:** TODO
- **Problem being solved:** Equipment appears as a supported booking charge type and a possible operational/logistics concern, but no equipment inventory or workflow has been audited.
- **Candidate schemas:** equipment item/type, inventory unit, allocation, requirement, location, movement, maintenance state. TODO.
- **Candidate workflows:** request; reserve/allocate; pick/load/deliver; return; inspect; maintain; reconcile.
- **Dependencies:** Events, Bookings, Production, Logistics, Sites/Locations, permissions and audit.
- **Current maturity:** Concept only from adjacent domain evidence.
- **Notes:** A commercial equipment charge is not itself an equipment allocation. Keep pricing and physical-resource state separate.

## Mobilisation

- **Classification:** Future domain; not a committed implementation
- **Purpose:** Coordinate the controlled setup or transition of Operational Locations, Clients, Service Arrangements and Operational Capabilities.
- **Business Owner:** Senior Management collectively, with a nominated coordinator for each mobilisation
- **Problem being solved:** Each mobilisation needs a consistent journey, accountable coordination, domain readiness and explicit mandatory, capability-conditional and Client/Operational Location-specific work.
- **Candidate schemas:** mobilisation, workstream, milestone, dependency, readiness check, decision, issue/risk, handover. TODO.
- **Candidate workflows:** initiate; define scope; assign owners; configure; validate readiness; migrate; train/handover; launch; close/review.
- **Dependencies:** Operational Location, Configuration, Workforce, Equipment, Media/Brand, Operational Capabilities, permissions, documents and audit.
- **Current maturity:** Business journey, stewardship, readiness and task-classification decisions are canonical; schema and implementation remain future work.
- **Notes:** Do not confuse application provisioning with the wider business mobilisation lifecycle.

## Workforce Planning

- **Classification:** Future domain; provisionally in scope, not a committed implementation
- **Purpose:** Coordinate workforce demand, rotas, relief, agency support, gaps, and employee-data-informed planning.
- **Business Owner:** TODO
- **Problem being solved:** A Workforce Operations Platform exists with rota, relief, agency, legacy import, gap detection, and BrightHR-related capabilities, but its maturity and authoritative boundaries need manual review.
- **Candidate schemas:** worker reference, role/skill, availability, shift, assignment, demand, gap, absence/provider reference. TODO and subject to privacy review.
- **Candidate workflows:** import/synchronise employee data; plan rota; detect gaps; assign relief/agency; approve/publish; reconcile changes; report.
- **Dependencies:** BrightHR adapter, Sites, Events/Production demand, permissions, privacy/security, audit and reporting.
- **Current maturity:** Existing fragmented/development capability; lifecycle and operational use TODO.
- **Notes:** Employee data requires explicit minimisation, lawful access, retention, permissions, and source-of-truth decisions before canonical modelling.

## Logistics

- **Classification:** Future domain; planned capability, not a committed implementation
- **Purpose:** Coordinate movements, deliveries, collections, drivers, routes, loads, destinations, and delivery outcomes across FIKA operations.
- **Business Owner:** TODO
- **Problem being solved:** The long-term hospitality flow continues from CPU into Logistics. Current CPU delivery events and a Deliveries Sheet provide limited operational evidence but no canonical logistics model.
- **Candidate schemas:** logistics job, stop, load/item allocation, route/run, driver/resource assignment, delivery window, status/event, proof/exception. TODO.
- **Candidate workflows:** create demand from production/event; plan/assign; pick/load; dispatch; deliver/collect; record exception/proof; reconcile/complete.
- **Dependencies:** Production Orders, Events, Sites/structured locations, Workforce/driver references, Equipment, Calendar/map/provider adapters, permissions and audit.
- **Current maturity:** Planned capability; no repository or adopted schema found.
- **Notes:** Define required-ready, dispatch, arrival, handover and service-time semantics before modelling. Current Calendar delivery records are transitional projections, not the target design.

## Executive Reporting

- **Classification:** Future domain; not a committed implementation
- **Purpose:** Provide trusted cross-domain operational and management insight using governed definitions and traceable source records.
- **Business Owner:** TODO
- **Problem being solved:** Operational reporting, hospitality feedback reporting, and client-specific hot-drinks reporting exist, but company-wide metric ownership and semantic definitions have not been inventoried.
- **Candidate schemas:** metric definition, dimension, reporting period, target, snapshot, variance, commentary and lineage reference. TODO.
- **Candidate workflows:** define/approve metric; collect/project; validate/reconcile; publish; annotate; retain snapshots; revise definitions.
- **Dependencies:** canonical domain records, operational projections, configuration, identity/permissions, audit/lineage, Events, Hospitality, Production, Logistics and Workforce.
- **Current maturity:** Fragmented reporting applications; no confirmed executive-reporting capability.
- **Notes:** Reports must not become competing operational sources. Metric definitions, owners, refresh expectations, sensitivity and retention require business approval.

## Cross-domain questions

- TODO: Confirm a business owner and decision forum for each domain.
- TODO: Identify current manual processes, records, users, volumes and pain before schema design.
- TODO: Confirm privacy, sensitivity, permission, retention and audit requirements.
- TODO: Determine which concepts are genuinely shared and which remain references to another domain.
- TODO: Decide when evidence is sufficient to promote a future domain into the roadmap.
