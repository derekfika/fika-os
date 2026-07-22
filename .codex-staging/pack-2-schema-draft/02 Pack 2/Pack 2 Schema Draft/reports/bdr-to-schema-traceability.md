# Pack 2 BDR-to-Schema Traceability Matrix

| Schema | Source BDRs | Decision basis | Boundary preserved |
|---|---|---|---|
| organisational-role.schema.json | ROLE-001, ROLE-002 | Role catalogue ownership; role/responsibility/authority separation | Role is durable business concept; does not grant authority itself. |
| responsibility.schema.json | ROLE-001, ROLE-002 | Responsibilities owned by roles/domains | Responsibility is not assignment and not authority. |
| assignment.schema.json | ROLE-002, ROLE-004 | Effective-dated person-to-role/responsibility/scope relationship | Assignment does not grant authority automatically. |
| authority-grant.schema.json | ROLE-001, ROLE-002, ROLE-003, ROLE-004, ROLE-006, ROLE-007 | Explicit AUTHMOD action grant by role/scope/effective period | Authority independent of job title, assignment and technical access. |
| permission-action-vocabulary.schema.json | ROLE-001, ROLE-003 | View, Contribute, Manage, Approve, Publish, Administer | Controlled action vocabulary only. |
| approval-publication.schema.json | ROLE-003, ROLE-005 | Approval and publication are separate actions | May be same actor only where authority permits. |
| access-boundary.schema.json | ROLE-006, ROLE-003, ROLE-004 | Least-privilege information access by purpose/scope/sensitivity | Access does not follow automatically from job title or admin. |
| emergency-access.schema.json | ROLE-007, ROLE-006 | Exceptional audited time-limited access | Not substitute for normal permissions. |
| operational-capability-catalogue.schema.json | CAP-001, CAP-004 | Catalogue of governed reusable business abilities | Capability does not own domain meaning or permissions. |
| capability-enablement.schema.json | CAP-001, CAP-002, CAP-004, CFG-002, CFG-003 | Approved capability availability in governed scope | Enablement is not permission or local definition. |
| capability-dependency-rule.schema.json | CAP-002, CAP-004 | Dependency/exclusion/eligibility/advisory rules | Rules are owned and approved; not inferred by apps. |
| capability-override.schema.json | CAP-003, CFG-002, CFG-003 | Effective-dated variation of inherited capability value/rule | Override cannot rewrite history or canonical meaning. |
