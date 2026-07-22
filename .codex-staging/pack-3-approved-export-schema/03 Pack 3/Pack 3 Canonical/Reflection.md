# Pack

Pack 3 — Service Domain

# Date

2026-07-14

# Domain(s)

Service domain, Service Arrangements, recurring schedules, scheduled work, service/event boundary, coffee-cart model, and service commercial ownership.

# What this Pack clarified

Pack 3 clarified Service as a canonical business domain and separated Service meaning from operational scheduling, booking, event, equipment, and production concerns. It established how recurring Service Arrangements and dated Service Occurrences should be understood without turning schedules, requests, or implementation mechanisms into the Service definition itself.

# Major business decisions

The pack records ten approved Service-domain Business Decision Records. It confirms the boundaries between Service, Service Arrangement, scheduled work, bookings, events, and commercial ownership, while preserving deferred concepts where the approved pack intentionally leaves them unresolved.

# Cross-document observations

The pack is internally aligned around business-first terminology, implementation independence, technology neutrality, and preservation of approved Decision wording. Cross-pack dependencies remain informational where the required target material sits outside the ZIP.

# Concepts intentionally deferred

Deferred concepts include Service Family, Service Template, Product, OPEXP, and final naming for shared fulfilment or work records where the approved pack records them as unresolved.

# Schema observations

Nine Draft 2020-12 business schema drafts were produced from the approved Service-domain BDRs. The schemas separate Service, Service Arrangement, recurring schedule, schedule exception, requested work input, event reference, equipment allocation, domain dependency, and commercial ownership concepts.

# Workflow improvements discovered

Pack Processing Standard v2.0 removes the previous gap around reflections by requiring the Reflection and Archive Certificate to be generated as part of the pack deliverable.

# Risks avoided

The pack avoids redefining approved Decisions, avoids promoting deferred concepts into canonical schemas prematurely, avoids implementation-specific modelling, and avoids treating repository integration as part of archive readiness.

# Evidence produced

- Number of BDRs: 10
- Number of Schemas: 9
- Number of Fixtures: 18
- Validation summary: 0 schema validation failures; 9 valid fixtures passed; 9 invalid fixtures failed as expected; 0 markdown export errors.

# Lessons learned

The Service domain benefits from strict separation between enduring business meaning and operational records created from that meaning. Archive readiness should be assessed at pack level, not document by document.

# Future domain candidates

Future packs may need to clarify Product, Service Template, Service Family, OPEXP, fulfilment/work records, and downstream production or logistics concepts.

# Recommendations for the next Pack

Continue preserving approved Decision wording exactly, resolve only concepts explicitly approved for resolution, and keep schema generation tied to canonical business meaning rather than implementation convenience.
