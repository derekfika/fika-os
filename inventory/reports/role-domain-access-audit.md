# Role, Domain and Access Evidence Audit

## Status and method

This read-only audit combines confirmed business context, architecture documents, the Business Discovery Google Sheet and the MNK mobilisation Google Sheet. It records historical responsibility evidence without converting it into permanent authority or technical permissions.

## Confirmed roles and responsibilities

| Evidence | Confirmed responsibility | Limitation |
|---|---|---|
| Karol | Brand approval and primary Marketing, Brand, Media and client-facing content need | Publication scope and second approvals unknown |
| Isaias | Ad hoc Events ownership with delegation; primary need across Events, quotes, labour coordination, production, logistics and portal publishing | Quote/financial/publication authority levels unknown |
| Derek | Coffee, Equipment, Hospitality, Reporting, Training and platform-development needs; currently informal Equipment-record ownership | Current involvement is not proof of permanent domain approval authority |
| Site manager role | Owns site-based Event from enquiry to delivery | Exact create/approve/escalate boundaries unknown |
| Dwayne | Identified as Events lead and current organiser of vans/equipment/deliveries with Francesco | Future Events/Logistics role split unknown |
| Francesco | Current logistics organiser and driver | Planning/approval/driver separation unknown |
| D'Angelo | Driver | Allowed updates and scope unknown |
| Ashley | Identified historically as Operations Manager in manual labour/logistics context | Current responsibilities/authority not confirmed |
| CPU chefs | Production users with allergen pain point | No named business owner or approver confirmed |
| Gill | Does not need machine-maintenance functionality | No positive role/responsibility evidence supplied |
| Ed | Established mobilisation spreadsheet/process is successful and long-lived | Does not prove ownership of every task or approval |
| Leadership | Needs broad summaries of risks, decisions, progress and performance | Named roles and approval authorities unknown |

## Provisional role catalogue

- Leadership
- Operations
- Workforce Planning
- Events
- Marketing
- Coffee
- Equipment and Maintenance
- Production
- Logistics Planner
- Logistics Driver/Executor
- Finance and Commercial
- Site Management
- Mobilisation Coordination
- Platform Administration

These roles may overlap for one person and are not job titles. Catalogue ownership and completeness remain unresolved.

## Possible duplicate or overlapping roles

- Events and Logistics currently overlap through Dwayne.
- Derek spans Coffee, Equipment, Hospitality, Reporting, Training and Platform Administration.
- Site Management and Events overlap for site-based events.
- Operations, Events and Finance may overlap in labour/logistics estimates and quote preparation.
- Mobilisation Coordination overlaps Operations, Site Management, Equipment, Workforce, Brand and Finance tasks.
- Workforce Planning and HR administration may be different responsibilities despite one current application area.
- Equipment management, maintenance execution and safety approval may require separate roles.

## People acting across several roles

- **Derek:** several operational/domain responsibilities plus platform development.
- **Isaias:** Events ownership plus quote, labour, production, logistics and publishing coordination.
- **Dwayne:** Events leadership and logistics/equipment movement coordination.
- **Francesco:** logistics coordination plus driving.
- **Site managers:** local operations plus site-based Events ownership.

This evidence supports composable roles and assignments rather than one role per person.

## Domain-access findings

| Finding | Evidence | Architectural implication |
|---|---|---|
| Access should follow actions and scope, not app names | Confirmed context and platform principles | Define domain action vocabulary before implementation |
| Homepage must be responsibility-based | Different confirmed needs for Gill, Karol, Isaias, Derek and Leadership | Compose homepage cards from roles/assignments |
| Site scope is essential | Site managers own local events; location relationships exist throughout domains | Role default plus assigned locations/projects |
| Temporary access is required | Events delegation and mobilisation projects are time-bound | Assignment start/end and review required conceptually |
| Approval is separate from work | Brand approval confirmed; commercial/safety/readiness approvals unresolved | Model approver responsibility explicitly |
| Leadership needs summary, not operational edit | Confirmed context | Summary-only access should be a first-class business outcome |
| Applications do not define access | Domains/workflows cross many current applications | Permission design comes after business actions |
| Exceptional access must be explicit | Cross-domain work and temporary cover are expected | Scope, reason, duration and audit required |

## Sensitive domains and information

- Workforce employee, absence, payroll and HR information.
- Customer/client contacts and commercially sensitive booking/event data.
- Dietary/allergen information required by Production.
- Contracts, pricing, margins, quotes and supplier accounts.
- Equipment safety, faults, servicing and return-to-service evidence.
- Site access, security, local policies and mobilisation readiness risks.
- Private configuration, provider credentials and role assignments.
- Audit history and emergency-access records.

Leadership and Reporting views must aggregate/minimise these details rather than copy source records broadly.

## Site-scoped responsibilities

- Site managers require Manage/Contribute within assigned locations, not all locations by default.
- Events staff may need company-wide pipeline access plus assigned project/venue detail.
- Production/Logistics need fulfilment data across several source locations but only fields required for work.
- Workforce planners may require cross-site coverage summaries while HR detail remains restricted.
- Mobilisation roles need project/site access that expires or changes at handover.
- Client users, when defined, must remain within explicitly shared client/location records.

## Task ownership conflicts and gaps

- MNK mobilisation tasks are mostly assigned to FIKA, MNK or both rather than named roles.
- Joint agreement/sign-off appears repeatedly without named approving authority.
- Final opening-readiness/go-live approval is not recorded.
- Equipment records are informally owned by Derek but the durable owner is unknown.
- Quote preparation/approval boundaries across Events, Operations and Finance are unknown.
- Production allergen and late-change approval is unknown.
- Logistics planner, driver and exception approver are not separated.
- Supplier-account and first-order ownership is broadly “FIKA.”
- Workforce planning versus HR administration is unresolved.
- Gill's positive responsibilities are unknown.

## Mobilisation phases discovered

The workbook does not explicitly label phases. Evidence supports these managerial task families:

1. award and mobilisation alignment;
2. service/commercial definition;
3. space, equipment and technology;
4. people, access and administration;
5. suppliers, products and first orders;
6. compliance, safety and training;
7. physical setup and opening readiness;
8. launch week and early debrief.

The main plan and Questions/Actions tabs contain conflicting go-live dates, indicating version/reuse risk.

## Duplicated and conflicting mobilisation information

- Suppliers repeat across Notes, product lists and First Orders.
- Product/supplier information repeats between product and order tabs.
- Task completion, open flags and order/delivery booleans represent overlapping status systems.
- Product/pricing decisions are not linked directly to mobilisation tasks.
- Equipment steps are related but lack explicit dependencies.
- Target go-live dates conflict across tabs.
- Questions/Actions exists but is empty in the inspected version.

## Likely FIKA OS homepage variants

- Leadership summary
- Operations control/exception view
- Workforce planning
- Events pipeline and delivery
- Marketing/Brand/Media
- Coffee operations
- Equipment and maintenance
- Production
- Logistics planner
- Driver/task execution
- Finance/Commercial approvals
- Site Management
- Mobilisation project
- Platform Administration

These should be composed from responsibilities and assignments, not hardcoded as separate applications.

## High-value mobilisation automation

1. One controlled plan version and launch date.
2. Named role/task ownership, deadlines and status.
3. Dependency and blocker tracking.
4. Reminders, overdue escalation and unanswered-question routing.
5. Supplier account and first-order tracking from shared references.
6. Equipment selection-to-training lifecycle.
7. Staffing/compliance/readiness summary with sensitive-data minimisation.
8. Evidence attachment/reference for completed high-risk tasks.
9. Explicit opening-readiness decision and approver.
10. Launch/debrief actions transferred into live operations.
11. Leadership progress/risk/decision summary.

Automation must not replace service design, commercial approval, hiring, risk assessment, equipment suitability, client sign-off or go/no-go judgement.

## Questions requiring confirmation

- Final platform role catalogue and owner.
- Positive responsibilities for Gill.
- Ed's exact relationship to mobilisation governance.
- Current Operations, Finance, HR, Production, Logistics and site-management owners.
- Action levels for every domain: view, contribute, manage, approve, publish and administer.
- Site/project scope and temporary assignment expiry.
- Quote, brand, safety, allergen, supplier and opening-readiness approval authority.
- Sensitive-data summary/minimisation rules.
- Leadership homepage and approval requirements.
- Emergency-access owner and review process.

## Audit conclusion

Evidence is sufficient for the role-and-access business workshop and for a faithful current mobilisation journey. It is not sufficient for a permissions schema or technical access design. The next step is owner interviews/workshop completion, followed by a business Role and Responsibility Decision Record.
