# Schema Review Checklist

Use this checklist for each fixed schema candidate. Record evidence or a link beside any item that is not self-evident. An unchecked blocking item prevents approval.

## Review identity

- [ ] Schema name and candidate version are recorded.
- [ ] Lifecycle status is `Under Review`.
- [ ] Review owner, business owner and reviewers are named.
- [ ] Review date and scope are recorded.
- [ ] The candidate has not changed since validation; otherwise validation has been rerun.

## Business meaning and boundaries

- [ ] The business concept is correct in plain language.
- [ ] The aggregate or value-object boundary follows accepted BDRs.
- [ ] The owning domain is explicit and correct.
- [ ] The schema states what it does not own.
- [ ] Business behaviour has not been invented or embedded as schema workflow.
- [ ] Canonical records are distinguishable from projections, audit records and adapter metadata.
- [ ] No application or provider behaviour has silently become canonical meaning.

## Properties

- [ ] Every required property is justified by one or more accepted BDRs.
- [ ] Every optional property has an evidenced purpose and owner.
- [ ] Required and optional properties are unambiguous.
- [ ] Names use canonical terminology consistently.
- [ ] No two properties duplicate the same business meaning.
- [ ] No property belongs to another domain.
- [ ] No provider-specific field appears in the canonical object.
- [ ] Provider identifiers, where referenced externally, remain non-canonical references with provenance.
- [ ] Sensitive and personal-data fields are necessary, owned and subject to an identified retention decision.

## Identity, relationships and history

- [ ] Canonical identity is stable and distinct from provider identity.
- [ ] Relationships are explicit.
- [ ] Relationship ownership is explicit.
- [ ] Cardinality is justified and correct.
- [ ] Referential rules do not depend on a storage implementation.
- [ ] Lifecycle and effective-dated history are preserved where BDRs require them.
- [ ] Amendments do not overwrite required history.
- [ ] Supersession, deprecation or replacement relationships are explicit where applicable.

## Validation and examples

- [ ] The schema definition is syntactically valid and all references resolve.
- [ ] Representative valid examples are present.
- [ ] Boundary-case valid examples are present where relevant.
- [ ] Invalid examples are present for missing required properties.
- [ ] Invalid examples are present for formats, relationships and constraints where relevant.
- [ ] Valid examples pass validation.
- [ ] Invalid examples fail for the intended reason.
- [ ] Fixtures use fictional, non-production data and contain no secrets.
- [ ] Validation is reproducible and its result is recorded.

## Traceability and compatibility

- [ ] Decision IDs and links to every related BDR are recorded.
- [ ] Every required property has property-level traceability.
- [ ] Dependencies on other schemas and decisions are recorded.
- [ ] Provider mappings are linked where applicable but remain separate.
- [ ] Current records and transitional adapters have been assessed for compatibility.
- [ ] Breaking and non-breaking effects are classified.
- [ ] Migration, deprecation and rollback implications are documented where applicable.
- [ ] No unresolved business decision blocks the candidate.

## Approval readiness

- [ ] Business owner confirms fidelity to approved meaning.
- [ ] Affected domain owners confirm cross-domain boundaries.
- [ ] Technical review confirms consistency, storage independence and validation quality.
- [ ] All blocking comments are resolved.
- [ ] Non-blocking items are recorded with owners or explicitly deferred.
- [ ] The exact candidate version is ready for approval.
- [ ] Approval and adoption are treated as separate status changes.

## Outcome

- [ ] **Ready for approval**
- [ ] **Return for revision**
- [ ] **Return to business decision process**
- [ ] **Blocked — TODO:** record blocker, owner and required action.

