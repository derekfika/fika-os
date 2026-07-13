# FIKA OS Discovery Register

## Purpose

This register captures genuine discoveries that emerge during business modelling but have not yet become canonical business concepts or complete canonical rules.

An entry here is not an approved BDR, schema, roadmap commitment or implementation authorisation. Promotion requires evidence, an accountable owner, governed discovery and an accepted BDR.

## Status vocabulary

- **High-priority discovery candidate:** business value is evident and focused discovery should be scheduled.
- **Confirmed future concept requiring governed refinement:** the concept exists canonically, but its catalogue or rules remain incomplete.
- **Future candidate:** the concept may be useful but requires more evidence or dependency resolution.
- **Future workshop required:** appropriate domain owners must establish business meaning.
- **Parked:** no current requirement justifies further modelling.

## Operational Relationship (OPREL)

- **Status:** High-priority discovery candidate.
- **Reason discovered:** Client and Client Contact identity does not describe how FIKA communicates and works with them in a particular operational context.
- **Potential future Pack:** Client and Relationship extension pack; numbering requires roadmap approval.
- **Dependencies:** Canonical Client and Client Contact; OPLOC; relationship roles; active dates; responsibilities; approval and escalation authority.

## Commercial Agreement (COMAG)

- **Status:** High-priority discovery candidate.
- **Reason discovered:** One commercial arrangement may connect a Client to several OPLOCs without collapsing their independent operational identities.
- **Potential future Pack:** Commercial domain pack; numbering requires roadmap approval.
- **Dependencies:** Client; OPLOC; Service commercial ownership; contract scope; billing; dates and renewals; service levels; profitability and reporting ownership.

## Operational Capability refinement

- **Status:** Confirmed future concept requiring governed BDR refinement.
- **Reason discovered:** OPCAP is canonical, but its exact catalogue, naming, domain ownership and assignment rules require further governed decisions.
- **Potential future Pack:** Operational Capability and Configuration pack.
- **Dependencies:** Accepted CAP BDRs; OPLOC; Configuration; Roles and Permissions; Mobilisation; accountable domain owners.

## CPU capability

- **Status:** Future OPCAP candidate.
- **Reason discovered:** CPU is distinct from ordinary Food Production and may support production for destination OPLOCs, logistics, dispatch, allocation, manifests and delivery confirmation.
- **Potential future Pack:** Operational Capability refinement followed by Production and Logistics packs.
- **Dependencies:** OPCAP catalogue refinement; OPLOC; Production; Logistics; destination relationships; Food Production and Food Safety boundaries.

## Food Production

- **Status:** Future workshop required.
- **Reason discovered:** Food Production may be an OPCAP and operational domain with preparation, allocation and traceability responsibilities that differ from ordinary Service delivery.
- **Potential future Pack:** Production capability or domain pack after discovery.
- **Dependencies:** Appropriate Operations and food-production owners; OPCAP refinement; Production Order boundaries; units and yields; Food Safety.

## Food Safety domain

- **Status:** Future workshop required.
- **Reason discovered:** HACCP, allergens, temperatures, hot holding, chilling, cleaning, traceability and related compliance require specialist business ownership and cannot be defined solely through general Production discovery.
- **Potential future Pack:** Food Safety and Compliance pack, subject to domain confirmation.
- **Dependencies:** Appropriate food-safety owner; Food Production; audit and retention requirements; regulatory evidence; responsibilities and approval authority.

## OPLOC Group

- **Status:** Parked.
- **Reason discovered:** A possible need to group OPLOCs was considered, but no current non-commercial use case exists that is not already served by Client or the COMAG candidate.
- **Potential future Pack:** None unless a real non-commercial grouping requirement emerges.
- **Dependencies:** Confirmed use case; OPLOC; Client; COMAG discovery; ownership and lifecycle of the grouping.

## Promotion criteria

A discovery may leave this register only when:

1. confirmed evidence establishes a genuine business need;
2. an accountable business owner is identified;
3. dependencies and contradictions are resolved;
4. the human decision owner approves exact business wording;
5. an accepted BDR records the decision and its consequences;
6. the [Domain Dictionary](02-domain-dictionary.md) and [Naming Conventions](03-naming-conventions.md) are updated without erasing discovery history.

## Related Canon

- [Cohesion Principles](01-cohesion-principles.md)
- [Domain Dictionary](02-domain-dictionary.md)
- [Naming Conventions](03-naming-conventions.md)
- [Authority Model](04-authority-model.md)

