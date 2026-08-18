# FIKA OS Domain Dictionary

## Purpose

This dictionary records the canonical vocabulary and controlled candidate terms used across FIKA OS. A dictionary entry explains language; it does not create a schema, approve a discovery candidate or override a Business Decision Record.

## Status vocabulary

- **Canonical:** established business language supported by approved business meaning.
- **Discovery Candidate:** a potentially useful concept that requires governed discovery and an approved BDR before becoming canonical.
- **Future Candidate:** a term or concept whose need or definition is not yet sufficiently confirmed.

## Operational Location (OPLOC)

- **Definition:** A durable identity for a site, venue or recurring operating context that FIKA works with over time, allowing Services, Events, Clients and operational history to remain associated with the same place as details change.
- **Purpose:** Answers where FIKA operates and preserves continuity across names, providers, Services and other changing relationships.
- **Owner:** Operations.
- **Status:** Canonical.

## Address

- **Definition:** Canonical structured master data identifying a physical postal address independently of any Operational Location or provider record.
- **Purpose:** Lets OPLOC and other authorised domains reference one reviewed address through a stable Address ID while preserving provider evidence separately.
- **Owner:** Operations; authority is exercised through role-based permissions under AUTHMOD.
- **Status:** Canonical; accepted through ADDR-001 on 2026-07-29. Individual Address records require separate review, approval and publication.

### Definition history

- **Before 2026-07-29:** LOC-003 established that physical address master data did not belong to OPLOC, but no governed Address contract existed.
- **2026-07-29:** Derek explicitly authorised Address as separate canonical master data. OPLOC retains only `addressReference`; provider or legacy address values remain evidence until reviewed.

## Location Type

- **Definition:** The primary classification that describes an OPLOC's fundamental operating model without replacing its identity.
- **Purpose:** Distinguishes materially different operating models while leaving Services and enabled behaviour to their appropriate concepts.
- **Owner:** TODO — final role-based catalogue ownership is subject to the governed TYPE-001 amendment.
- **Status:** Canonical.

## Operational Capability (OPCAP)

- **Definition:** A reusable business function that an OPLOC may enable to support how FIKA operates, independently of the OPLOC's identity or Location Type.
- **Purpose:** Describes what an OPLOC is able to do without defining how the relevant domain operates internally.
- **Owner:** Operations Leadership owns the organisation-wide catalogue; the relevant domain owner owns each capability's business meaning and lifecycle. Platform Governance maintains technical representation without becoming business authority.
- **Status:** Canonical; accepted through CAP-001 on 2026-07-28. Catalogue entries and capability enablement remain separately governed.

### Definition history

- **Before 2026-07-28:** The dictionary described OPCAP as Canonical while CAP-001 metadata remained Draft, creating a status mismatch.
- **2026-07-28:** Derek explicitly accepted CAP-001 without changing its Decision. Later the same day, Derek confirmed that every completed Pack 1–8 Decision—including CAP-002 through CAP-004—was already accepted and that the remaining Draft labels were metadata errors. Individual catalogue entries and OPLOC enablement records still require their own governed record decisions.

## Legend

- **Definition:** The durable canonical identity of a human recognised by FIKA OS.
- **Purpose:** Preserves one reviewed FIKA identity independently of provider identities and changing employment or operational relationships.
- **Owner:** TODO — the governed BDR identifier and role-based business owner must be registered through the established decision process.
- **Status:** Canonical; the definition was explicitly accepted by Derek on 2026-07-28. Individual records remain subject to separate review and publication.

### Definition history

- **Before 2026-07-28:** Future Candidate whose population and boundary were unresolved.
- **2026-07-28:** Derek accepted the durable human-identity boundary. Employment, Absence, emergency contacts, training, qualifications, Operational Assignments, performance information, provider-specific HR records and restricted HR evidence remain separate.

## Operational Assignment

- **Definition:** An effective-dated, formally recognised and ongoing operational relationship between one Legend and one OPLOC.
- **Purpose:** Answers who has an approved ongoing operational connection to an Operational Location without turning employment, rota evidence or occasional cover into the relationship itself.
- **Owner:** TODO — the governed BDR identifier and role-based business owner must be registered through the established decision process.
- **Status:** Canonical; the definition was explicitly accepted by Derek on 2026-07-28. Individual assignments remain subject to separate review and publication.

### Definition history

- **Before 2026-07-28:** Proposed discovery distinct from the development-only Site Assignment contract.
- **2026-07-28:** Derek accepted Operational Assignment as the durable Legend-to-OPLOC relationship. It does not represent Employment, a rota shift, occasional cover, historical appearance, future scheduled work or an inference from frequency.

## Service Arrangement

- **Definition:** One defined recurring Service delivered at a single OPLOC, with its own operational history, configuration and lifecycle.
- **Purpose:** Represents the durable arrangement from which effective-dated recurring schedules and dated Service Occurrences can be governed.
- **Owner:** Operations and the relevant Service owner; commercial responsibilities remain distinct.
- **Status:** Canonical.

## Booking

- **Definition:** A record of customer demand created when a customer requests, reserves or purchases something from a Service Occurrence or bespoke Event.
- **Purpose:** Preserves the commercial and service intent that downstream operational work consumes.
- **Owner:** Hospitality and Operations, with commercial ownership governed by the applicable business relationship.
- **Status:** Canonical.

## Client

- **Definition:** An external organisation with which FIKA has a commercial or operational relationship; individual people are represented separately as Client Contacts.
- **Purpose:** Owns stable organisational identity and shared business information independently of any individual OPLOC.
- **Owner:** Commercial.
- **Status:** Canonical.

## Client Organisation (CLORG)

- **Definition:** A proposed name or abbreviation for the organisational concept currently represented canonically as Client.
- **Purpose:** May help distinguish an organisation from a Client Contact or relationship, but must not create a duplicate of Client.
- **Owner:** TODO — Commercial discovery owner required.
- **Status:** Discovery Candidate.

## Commercial Agreement (COMAG)

- **Definition:** A candidate commercial anchor through which one agreement may relate a Client to one or more OPLOCs and govern agreed commercial terms.
- **Purpose:** May separate contract scope, billing, dates, renewals, service levels, profitability and commercial reporting from Client and OPLOC identity.
- **Owner:** TODO — Commercial owner required.
- **Status:** Discovery Candidate.

## Operational Relationship (OPREL)

- **Definition:** A candidate description of how FIKA works with a Client organisation and its Client Contacts in a particular operational context.
- **Purpose:** May govern communication methods, meeting cadence, responsibilities, reporting expectations, escalation routes, approvals, relationship ownership and active dates.
- **Owner:** TODO — joint Commercial and Operations ownership requires discovery.
- **Status:** Discovery Candidate.

## Venue

- **Definition:** A Location Type for an OPLOC where FIKA delivers occasional or recurring work without maintaining an ongoing operational presence.
- **Purpose:** Distinguishes engagement-specific operation from an ongoing FIKA presence without creating a new OPLOC identity.
- **Owner:** Follows the governed Location Type catalogue.
- **Status:** Canonical.

## Site

- **Definition:** A Location Type for an OPLOC where FIKA maintains an ongoing operational presence.
- **Purpose:** Identifies the ongoing-presence operating model without using individual Services, tills or capabilities as the Type.
- **Owner:** Follows the governed Location Type catalogue.
- **Status:** Canonical.

## Authority notes

- Candidate abbreviations are reserved for their stated meaning but are not canonical merely because they appear here.
- Where a definition requires new business policy, follow the [Discovery Register](05-discovery-register.md) and the governed BDR process.
- Roles and catalogue authority follow the [Authority Model](04-authority-model.md).

## Sources

- [ADDR-001 — Canonical Address Master Data](../business-decisions/addr-001-canonical-address.md)
- [CLIENT-001 — Client and Client Contact Definition](../business-decisions/client-001-client-definition.md)
- [LOC-001 — Operational Location Definition](../business-decisions/loc-001-operational-location.md)
- [LOC-002 — Operational Location Name](../business-decisions/loc-002-operational-location-name.md)
- [TYPE-002 — Primary Location Type](../business-decisions/type-002-primary-location-type.md)
- [CAP-001 — Operational Capability Definition](../business-decisions/cap-001-operational-capability-definition.md)
- [SVC-004 — Service Arrangement Scope](../business-decisions/svc-004-service-arrangement-scope.md)
- [SVC-006 — Scheduled Work and Booking Boundary](../business-decisions/svc-006-scheduled-work-and-booking-boundary.md)

## Related Canon

- [Cohesion Principles](01-cohesion-principles.md)
- [Naming Conventions](03-naming-conventions.md)
- [Authority Model](04-authority-model.md)
- [Discovery Register](05-discovery-register.md)
