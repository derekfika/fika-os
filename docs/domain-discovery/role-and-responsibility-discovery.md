# Role and Responsibility Discovery

## Status and evidence boundary

This is business discovery, not a permissions model or implementation. It uses confirmed context, architecture documents, the Business Discovery workshop, and the MNK mobilisation workbook. Workbook task ownership is historical process evidence and must not be treated automatically as a current job description, permanent authority or future access grant.

Private contact details, addresses and sensitive operational identifiers are not reproduced.

## A. Plain-English role model

### Principle under review

> A platform role describes the responsibilities a person performs in FIKA OS. Job titles and platform roles may overlap, but they are not necessarily identical.

The evidence supports this principle. Isaias's confirmed Events responsibilities cross quotes, labour coordination, production, logistics and publishing. Derek's confirmed responsibilities cross Coffee, Equipment, Hospitality, Reporting, Training and platform development. A single job title would not safely express either person's complete platform needs.

### Concept distinctions

| Concept | Plain-English meaning | What it must not be confused with |
|---|---|---|
| Employee | A person in FIKA's workforce context | A login, role or permission grant |
| Job title | Organisational employment title | A complete list of platform responsibilities |
| Platform role | A reusable bundle of related FIKA OS responsibilities | A person, job title, site assignment or permanent authority |
| Responsibility | A business outcome or activity someone is expected to perform | Technical access or ownership of every related record |
| Task owner | Person or role accountable for progressing one task | Permanent domain owner or approver |
| Approver | Person or role authorised to make a defined decision | The task worker or broad administrator |
| Site assignment | A person's responsibility within one or more locations | Company-wide access |
| Temporary assignment | Time-limited responsibility for a project, mobilisation, event or cover | Permanent role membership |
| Permission | A specific allowed business action on a resource and scope | Role name, homepage visibility or job title |

### Recommended relationship

```text
Person/employee
  -> may hold one or more platform roles
  -> may receive site or project assignments
  -> may own individual tasks
  -> may hold specific approval authority
  -> receives effective business access from all of the above
```

Final role names, authority and access remain workshop decisions.

## B. Candidate platform roles

| Candidate role | Purpose | Typical responsibilities | Domains viewed | Domains edited | Approval responsibilities | Site scope | Sensitive information | Explicit examples | Open questions |
|---|---|---|---|---|---|---|---|---|---|---|
| Leadership | Understand performance, risk, progress and decisions across FIKA | Review summaries, exceptions, strategic risks and approvals | Reporting, Mobilisation, Locations, Events, Workforce summaries, Audit summaries | Usually limited commentary/decisions | Strategic or exception approvals: TODO | Company-wide summary | Commercial, workforce and risk summaries | No named example confirmed | Which leaders approve which decisions? What detail is necessary? |
| Operations | Coordinate day-to-day and cross-domain delivery | Resolve operational exceptions, align services, labour, sites and launches | Locations, Services, Events, Production, Logistics, Equipment, Workforce, Reporting | Contribute/manage operational records within assignment | Operational readiness/exception approvals: TODO | Company-wide or assigned locations | Client, staffing, safety and performance detail | Ashley is identified historically as Operations Manager in the discovery sheet | Current owner and delegated authorities? |
| Workforce Planning | Ensure staffing demand, availability and cover align | Rota, relief, gaps, absence implications, mobilisation staffing | Workforce, Locations, Services, Events/Production demand, Mobilisation | Manage planning records | Workforce publication/exception approval: TODO | Assigned locations or company-wide planning | Employee and absence data | No named example confirmed | HR versus operations responsibilities and privacy boundaries? |
| Events | Progress event opportunities and delivery | Enquiries, event pipeline, quotes, tasks, labour coordination, production/logistics coordination, portal publishing | Events, Clients, Locations, Services, Quotes, Production, Logistics, Equipment, Media, Reporting | Create/manage Events and related coordination records | Event/quote/publication approvals: TODO | Company-wide Events and assigned venues/projects | Client/commercial/event data | Isaias confirmed; site manager owns site-based event, while Isaias owns ad hoc event and may delegate | Delegation, quote approval and publication authority? |
| Marketing | Govern public/client-facing identity and content | Brand, media, client content, campaigns, portal content and asset requests | Brand, Media, Events, Locations/Services context, Reporting summaries | Contribute/manage content and media | Brand/content publication approval | Company/client/brand scope | Embargoed content, brand assets and client materials | Karol confirmed as brand/content approver and primary Marketing/Brand/Media user | Who can publish versus prepare content? |
| Coffee | Operate and improve coffee services | Coffee offer, quality, equipment context, reporting and training | Services, Locations, Coffee reporting, Equipment, Training | Manage coffee-service operational content within scope | Coffee standards/equipment choices: TODO | Company-wide coffee remit and assigned locations | Supplier/pricing/quality information | Derek confirmed primary need | Which operational/site managers share this role? |
| Equipment and Maintenance | Keep equipment records, condition, faults and servicing visible | Register assets, faults, servicing, risk and mobilisation equipment tasks | Equipment, Locations, Mobilisation, relevant Audit/Reporting | Manage equipment records/faults | Safety/return-to-service approval: TODO | Company-wide or assigned sites/assets | Safety, fault and servicing evidence | Derek currently owns equipment records “ish”; Gill explicitly does not need machine-maintenance functionality | Who is the true business owner and qualified approver? |
| Production | Plan and progress production work | Review demand, allergen/dietary requirements, prepare, record exceptions and hand-off | Production, Services, Bookings needed for fulfilment, Locations, Logistics | Manage Production workflow | Production readiness/allergen sign-off: TODO | Production facility and assigned demand | Dietary/allergen, client and production details | CPU chefs confirmed as user group; no individual owner confirmed | Who approves changes/cancellations and allergen controls? |
| Logistics | Plan and execute movement of food/equipment | Assign deliveries/drivers, routes, exceptions, proof and mobilisation deliveries | Logistics, Production, Events, Locations/service points, Equipment | Manage logistics jobs/assignments | Dispatch/exception approval: TODO | Company-wide or assigned runs | Driver, location/access and delivery detail | Dwayne and Francesco currently organise vans/equipment/deliveries; Francesco and D'Angelo are identified as drivers | Separate planner, driver and approver roles? |
| Finance and Commercial | Govern commercial terms, pricing, quotes and financial reporting | Contracts, costings, margin, supplier/commercial approvals and reporting | Clients, Services, Bookings, Events, Quotes, Reporting, Mobilisation commercial tasks | Manage commercial configuration/records | Pricing, quote, supplier/contract approval | Company/client scope | Contracts, margins, payroll/financial detail | No named example confirmed | Exact separation from Operations and Events? |
| Site Management | Coordinate one or more operating locations | Daily operations, client contacts, local events, staffing/equipment issues and site tasks | Assigned Locations, Services, Bookings/Events, Equipment, Workforce, Reporting | Manage assigned-site operational records | Local readiness/exception approvals: TODO | Explicit assigned locations | Client contacts, local workforce and safety data | Site manager is confirmed owner for site-based events; no named example | What can site managers approve versus escalate? |
| Mobilisation Coordination | Preserve and coordinate the established mobilisation process | Plan tasks, dependencies, deadlines, questions, readiness and handover | Mobilisation, Locations, Services, Workforce, Equipment, Brand, Configuration, Reporting | Manage mobilisation plan/task records | Readiness recommendation; final approval TODO | Assigned mobilisation projects | Contracts, access, staffing, supplier and risk information | Ed's spreadsheet/process is confirmed as established and successful; this does not prove permanent task ownership | Is Ed process owner, coordinator, approver, or steward? |
| Platform Administration | Govern FIKA OS configuration, role assignments and platform change | Platform development, configuration, access administration and support | Configuration, Permissions, Audit, domain metadata; business data only as needed | Administer platform/configuration within authority | Technical/configuration approval, not automatic business approval | Company-wide platform scope | Highly sensitive configuration, access and audit | Derek confirmed platform-development need | Separation of platform admin from business-domain approval? |

The catalogue is incomplete until business owners confirm Finance, HR, Operations, Production, Logistics and site responsibilities.

## C. Provisional domain access needs

Access terms describe business need, not technical permission.

| Domain | Likely business access needs | Restricted/summarised treatment | Status |
|---|---|---|---|
| Sites or Locations | Leadership: Summary/Read; Operations: Manage; Site Management: Manage assigned; Mobilisation: Contribute; most domain roles: Read assigned | Hide private contacts/access details unless needed | Provisional |
| Services | Operations/Site Management: Manage; domain service owners: Manage; Leadership: Summary; Events/Production/Logistics: Read relevant | Commercial configuration may require Finance restriction | Provisional |
| Bookings | Hospitality/Site users: Manage assigned; Events/Production/Logistics: Read only required fulfilment fields; Leadership: Summary | Customer contact, dietary and commercial fields minimised | Provisional |
| Events | Events: Manage; Site Management: Manage/contribute site events; Leadership/Operations: Summary/Read; Marketing/Production/Logistics: Contribute assigned | Client/commercial detail scoped to task | Provisional |
| Production | Production: Manage; Events/Operations: Contribute/Read; Logistics: Read hand-off; Leadership: Summary | Dietary/allergen and client detail restricted | Provisional |
| Logistics | Logistics: Manage; Events/Production/Operations: Contribute/Read; drivers: task-specific contribute; Leadership: Summary | Driver/contact/access information restricted | Provisional |
| Equipment | Equipment role: Manage; Site/Operations/Mobilisation: Contribute; Leadership: Summary; Gill: no machine-maintenance by confirmed context | Safety/servicing detail limited to responsible roles | Provisional |
| Media | Marketing/Media: Manage/Publish; Events: Contribute; Leadership: Summary | Rights, embargoes and private client assets restricted | Provisional |
| Brand | Marketing/Brand: Manage/Approve/Publish; Events/Site roles: Read/use approved; Leadership: Summary | Approval/publishing separated from contribution | Provisional |
| Mobilisation | Coordinator: Manage; task owners: Contribute; supporting roles: Read/Contribute; Leadership: Summary/Approve where defined | Contract, access, staffing and supplier detail restricted | Provisional |
| Workforce | Workforce/HR: Manage; Operations/Site Management: scoped Contribute/Read; Leadership: Summary | Employee, absence, payroll and HR records highly restricted | Provisional |
| Waste | Unresolved owner; Operations/Site roles may contribute if domain confirmed; Leadership: Summary | No access model until business problem/owner exists | Unresolved |
| Reporting | Leadership: Read summaries; domain owners: Read/manage definitions where authorised; clients: scoped published views | Underlying sensitive fields must not leak through reports | Provisional |
| Configuration | Platform/authorised domain admins: Administer; Operations/Site managers: contribute to scoped values; most users: no direct access | Private configuration and secrets restricted | Provisional |
| Permissions | Platform/security administrators: Administer; managers: request/review scoped access; users: view own access | Role/grant details and emergency access restricted | Provisional |
| Audit | Auditors/platform/security: Read; domain owners: scoped Read; Leadership: Summary | Immutable history and personal data access controlled | Provisional |

## D. Role-based FIKA OS homepage

| Role | Provisional homepage priorities | What should be summarised or hidden |
|---|---|---|
| Leadership | Risks, mobilisation progress, operational exceptions, performance, approvals and decisions | Hide routine task detail and sensitive personal records unless explicitly opened |
| Operations | Cross-site exceptions, service issues, staffing impacts, events/production/logistics risks, mobilisation blockers | Summarise technical/provider state |
| Workforce Planning | Staffing gaps, relief cover, absence implications, unfilled mobilisation roles and upcoming demand | Hide unrelated commercial/client content |
| Events | Enquiries, pipeline, quotes, tasks, labour, production, logistics, content/publication status and exceptions | Hide unrelated machine maintenance and workforce records |
| Marketing | Media requests, brand approvals, portal content, campaigns, upcoming events needing assets and publication deadlines | Hide operational staffing and maintenance details |
| Coffee | Coffee-service performance, quality issues, equipment context, training, product/supplier actions and relevant mobilisation tasks | Hide unrelated Events/HR domains |
| Equipment and Maintenance | Open faults, overdue servicing, safety risks, new-site equipment tasks and assets awaiting action | Hide unrelated commercial/customer detail |
| Production | Upcoming demand, changes/cancellations, allergens/dietaries, prep status, shortages and logistics hand-offs | Show only required customer/service detail |
| Logistics | Unassigned deliveries, route/driver work, readiness, late changes, equipment movements and exceptions | Hide unrelated pricing and HR detail |
| Finance and Commercial | Quotes/pricing requiring approval, contract/supplier actions, margin/reporting exceptions and mobilisation commercial blockers | Hide operational personal detail |
| Site Management | Today's local service, bookings/events, staffing/equipment exceptions, client actions and local tasks | Other sites hidden unless assigned |
| Mobilisation Coordination | Milestones, overdue tasks, dependencies, unanswered questions, first orders, compliance/readiness and launch risk | Summarise unrelated live operations |
| Platform Administration | Service health, configuration/access requests, audit exceptions, documentation and platform change progress | Business data only where support requires it |

Gill's homepage requirements remain unknown beyond the confirmed exclusion of machine-maintenance functionality.

## E. Mobilisation evidence summary

The MNK workbook is an established checklist and coordination artefact. It covers contract/service alignment, equipment, recruitment, access, technology purchases, supplier setup, product/pricing lists, compliance, training, first orders, physical setup, launch and debrief.

Ownership is usually recorded as `FIKA`, `MNK` or both. This supports organisational responsibility but not permanent individual platform roles. Detailed journey and process-preservation guidance are in `docs/business-journeys/new-site-mobilisation-journey.md`.

## F. Mobilisation role-map principles

- Preserve the workbook's organisational ownership where that is all the evidence provides.
- Assign a named responsible role only after owner confirmation.
- Distinguish the task worker from joint sign-off and final opening approval.
- Treat Ed's established process stewardship separately from responsibility for every task.
- Use time-limited mobilisation project assignments rather than permanent company-wide access.
- Carry site/client scope into every task and document.

## G. Access principles

1. Least privilege: people see and change only what their responsibilities require.
2. Role-based defaults: roles provide a sensible starting set, not unquestioned authority.
3. Site-scoped access: local responsibilities do not imply access to every location.
4. Temporary project access: mobilisation, event and cover assignments expire or are reviewed.
5. Approval separation: creating/updating work does not automatically grant approval or publication.
6. Sensitive-data restriction: workforce, payroll, dietary/allergen, contracts, access and audit data are minimised.
7. Leadership summary views: leaders receive risks, decisions and progress before operational detail.
8. Auditability: important grants, approvals, overrides and changes are attributable.
9. Emergency access: exceptional access is time-bound, justified, reviewed and auditable; owner TODO.
10. Role-change review: access is reviewed after job, responsibility, site or project changes.
11. Application independence: access follows business actions/domains, not app names.
12. Explicit exceptions: exceptional access is approved for a scope and period rather than added permanently to a role.

## H. Open-question routing

- **Derek:** role catalogue ownership, Platform Administration separation, Coffee/Equipment remit, emergency access and cross-domain exceptions.
- **Ed:** mobilisation process phases, stewardship, task-assignment practice, readiness decision and which administrative work can be automated safely.
- **Operations:** operational/site roles, local approvals, exception ownership and current mobilisation responsibilities.
- **Gill:** positive domain/homepage needs and any non-maintenance responsibilities.
- **Isaias:** Events scope, delegation, quote/labour/production/logistics coordination and publication authority.
- **Karol:** Brand/Media contribution, approval and publication boundaries.
- **CPU:** production access, allergen control, booking detail minimisation and production approvals.
- **Logistics:** planner/driver roles, assignment authority, delivery proof and exception approval.
- **Finance:** commercial access, pricing/quote/supplier approvals and leadership summary measures.
- **HR:** workforce/privacy, absence/payroll access, role changes and temporary assignment lifecycle.
- **Site managers:** local event/service responsibilities, client contact access and escalation boundaries.

## Discovery conclusion

There is enough evidence to run a role-and-access workshop and document the current mobilisation journey. There is not enough evidence to adopt a role catalogue or domain access model. The workshop must confirm responsibilities and approval authority before any technical permission design.
