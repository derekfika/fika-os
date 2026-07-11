# FIKA Location Domain Workshop v3

## Status and purpose

This workshop separates three decisions that must not be collapsed:

1. the single canonical location business object;
2. a catalogue of location types;
3. independently enabled location capabilities.

It does not adopt a name, model, schema or implementation. The intended business outcome is a simple setup experience in which a new location can eventually be established in approximately thirty seconds by creating one record, choosing a type, accepting sensible capability defaults and changing only genuine exceptions.

## Decision 1: Canonical Location

This section concerns only the durable business object. It deliberately does not decide location types, tills, dashboards or capabilities.

### Candidate plain-English definition

The canonical object represents a place or durable operating context that FIKA needs to recognise consistently over time. It gives the business one identity to reference even when its name, operating state, relationships or external systems change.

The final name is open. Candidate terms remain `Location`, `Venue`, `Operational Location` and `Site`.

### Candidate responsibility boundary

| Question | Pre-filled evidence | Decision owner | Status | Final answer | Notes |
|---|---|---|---|---|---|
| What does the canonical object represent? | Evidence supports a durable place or operating context recognised by FIKA, including managed premises and recurring client-service contexts. | Derek / Operations | Open |  | Avoid defining it by current folders or providers. |
| What is the final business name? | `Site` is familiar but narrow; `Location` is broad; `Venue` is event-oriented; `Operational Location` is precise but longer. | Derek | Open |  | No automatic selection. |
| What does it own? | Candidate ownership: stable identity, approved current name, historical aliases, lifecycle and durable relationships. | Derek / Operations | Open |  | Confirm whether any other facts are essential to identity. |
| What does it not own? | Existing discovery separates client, brand, building/address, service point, recurring service, configuration and provider relationships. | Derek / Domain owners | Open |  | Confirm boundaries before modelling. |
| Does it exist independently of providers? | Platform principles require provider-independent canonical identity. Wise confirms an operating context can exist without the standard provider-location model. | Derek | Confirmed direction |  |  |
| Can it exist before opening? | Planned locations and mobilisation are confirmed future concerns. | Derek / Mobilisation owner | Open |  | Decide creation threshold and pre-opening lifecycle. |
| Does it remain after closure? | Stable history, reporting and audit favour retaining identity; no closure policy is confirmed. | Derek / Operations / Data owner | Open |  | Decide closed/legacy retention and re-opening. |
| Does it survive a provider migration? | Provider mappings are explicitly separate from canonical identity. | Derek / Platform | Confirmed direction |  |  |
| Can its current name change while identity remains? | The Line retains historical evidence under its former venue name and short alias. | Derek | Confirmed evidence |  | Decide alias governance. |
| Is it necessarily one physical building? | Building and physical address were separated during discovery; cardinality is unconfirmed. | Derek / Operations | Open |  | One-to-one, one-to-many or time-bound relationship? |
| Can one client relate to several canonical locations? | Client and location are separate boundaries, but cardinality has not been confirmed. | Derek / Commercial | Open |  |  |
| Can one canonical location relate to several clients? | No confirmed policy. Event and shared-building contexts may require it. | Derek / Commercial | Open |  |  |
| What minimum facts are required to create it? | A stable identity and approved name are supported; all other minimums remain undecided. | Derek / Operations | Open |  | Keep the eventual creation step short. |
| Who owns creation, renaming, closure and merge decisions? | No authoritative owner is recorded. | Derek | Open |  | Required before adoption. |

### Candidate relationships

The canonical object may reference, without owning:

- organisation context;
- one or more client relationships, subject to cardinality decisions;
- brand selection;
- building/address relationships;
- precise service locations such as rooms or delivery points;
- recurring service arrangements;
- event venues/events;
- application configuration;
- provider integrations;
- audit history.

### Canonical-location decision test

The decision is ready only when the business can answer:

- what makes two records the same location over time;
- when a record should be created;
- when two records should be merged or remain separate;
- what survives renaming, moving, closure and re-opening;
- who owns those decisions.

## Decision 2: Location Types

Location types are classifications, not identity. They should describe a common operating pattern and may supply recommended defaults. They must not prevent exceptions.

See [location-type-catalogue.md](C:\FIKA\fika-platform-specs\docs\business-workshops\location-type-catalogue.md) for the candidate catalogue and decision questions.

Key decision: should a canonical location have one primary type, several types, or a primary type plus time-bound secondary classifications?

## Decision 3: Capability Model

Capabilities state what is enabled for a location. They are independent from identity and should remain independently selectable even when a type recommends defaults.

See [location-capability-model.md](C:\FIKA\fika-platform-specs\docs\business-workshops\location-capability-model.md) for the candidate catalogue, default/override questions and downstream effects.

Key decision: types should recommend sensible starting capabilities, while explicit approved overrides determine the effective capability set.

## Configuration Inheritance

Configuration should be owned at the highest sensible level, inherited predictably and overridden only where a genuine difference exists.

| Configuration item | Proposed owner/scope | Possible inheritance | Override question | Status |
|---|---|---|---|---|
| Primary colour | Brand | Brand → location/application where allowed | May a client or location override the semantic palette? | Open |
| Logo | Brand | Brand → location/application | Which co-brand/white-label rules apply? | Open |
| Calendar | Application or provider integration | Capability/type may recommend requirement | Is it one calendar per location, workflow or application? | Open |
| Drive folder | Application or provider integration | Location may supply a context/reference | Who owns creation, retention and access? | Open |
| Email recipients | Application/workflow configuration | Client/location defaults may apply | Are recipients role assignments rather than addresses? | Open |
| Till mapping | Provider integration | None from canonical identity | Can several mappings coexist by capability/effective date? | Open |
| Supplier accounts | Provider integration or future Supplier domain | Client/location reference where approved | Is supplier identity separate from account configuration? | Open |
| Booking rules | Capability/domain configuration | Organisation/client/type defaults → location override | Which rules may vary, and who approves exceptions? | Open |
| CPU routing | Capability/domain configuration | Location type or service may recommend | Does routing belong to service arrangement or location? | Open |
| Printer | Application/provider integration | Capability default → location/application override | Is printer routing workflow-specific? | Open |
| Opening hours | Location or recurring service arrangement | Type may suggest fields, not values | Are service hours different from building hours? | Open |
| Equipment | Equipment domain/assignment | Type may recommend required categories | Do not store equipment inventory as configuration. | Open |
| Manager | User/role assignment | Organisation/client/location scope | Use time-bound role, not free-text contact? | Open |
| Menus | Hospitality capability/catalogue reference | Client/type defaults → location/service override | Who owns catalogue and effective dates? | Open |
| Pricing | Commercial policy/configuration | Client/service/type defaults → approved override | Who owns pricing and amendments? | Open |

### Inheritance principles for decision

1. Organisation supplies global defaults.
2. Client supplies commercial/relationship defaults where approved.
3. Brand supplies identity and presentation rules.
4. Location Type supplies recommendations, not immutable truth.
5. Location supplies durable location-specific choices.
6. Capability supplies domain policy and required configuration.
7. Application supplies experience-specific behaviour.
8. Provider Integration supplies optional external mappings and private connection details.
9. Secrets are never inherited as ordinary visible configuration.

Precedence, ownership and allowed overrides must be decided per item; no universal order should silently override business policy.

## Real Examples

These are workshop proposals, not adopted classifications.

| Example | Canonical location | Proposed location type | Candidate enabled capabilities | Likely applications | Likely integrations | Configuration inherited | Configuration overridden / open |
|---|---|---|---|---|---|---|---|
| MNK | One durable MNK location record | Standard Managed Site (proposed) | Hospitality, Bookings, Dashboard, Quotes, Calendar, Documents, Reporting, Feedback; Production/Logistics relationships to confirm | Booking platform, hospitality dashboard, client portal | Calendar, Gmail, Drive, Sheets; till status not assumed | FIKA brand, organisation policy, hospitality defaults | Site name/brand expression, menus, pricing/fees, recipients, routing and app settings; exact ownership TODO |
| Angel Court | One durable Angel Court location record | Standard Managed Site (proposed) | Hospitality, Bookings, Dashboard, Quotes, Calendar, Documents, Reporting, Feedback; legacy ingestion support | Booking platform and hospitality dashboard | Calendar, Gmail, Drive, Sheets; provider mappings optional | FIKA/client brand and hospitality defaults | Legacy inbox adapter, menus, recipients, routing and app settings |
| Wise | One durable Wise location record | Recurring Service Venue (proposed) | Recurring breakfast, recurring lunch, Production, Logistics and Reporting candidates; till not assumed | No dedicated application confirmed | Provider relationships TODO | Organisation and service-policy defaults | Two weekly service arrangements, approximate 450–500 attendance each, production/logistics details TODO |
| The Line | One durable The Line record with former-name aliases | Event Venue or mixed managed venue (decision required) | Hospitality, Dashboard, Quotes, Calendar, Documents, Events and Reporting candidates | Existing hospitality dashboard; planned separate public experience and shared Events Dashboard | Calendar, Gmail, Drive, Sheets; other providers optional | FIKA/Events brand rules and venue defaults | Historical aliases, event/hospitality split, workflows and brand context |
| Temporary Pop-up | Create a canonical record only if the persistence threshold is met | Pop-up (proposed) | Events, Equipment, Logistics, Documents, Media, Reporting and Notifications candidates | Future public/internal event experiences | Optional per event/pop-up | Event/pop-up type defaults and brand | Dates, venue relationship, temporary configuration and approved exceptions |
| Future one-day event | Usually reference the event venue without creating a durable location unless the threshold is met | Event Venue only if promoted; otherwise Event-domain venue | Events plus event-specific requirements | Future Events Dashboard/public channel | Optional per event | Event and brand defaults | One-day schedule, venue, equipment/logistics needs; location creation decision |

## Decision Matrix

| Decision | Business Owner | Current Evidence | Confidence | Blocking | Recommended Next Step |
|---|---|---|---|---|---|
| Canonical object definition | Derek / Operations | Durable provider-neutral context is supported by managed sites, Wise and historical aliases | High direction; medium boundary | Yes | Approve definition and ownership boundary |
| Final canonical name | Derek | Four viable terms with different strengths | Medium | Yes before model/schema | Choose after definition, not from current code |
| Creation/closure/identity rules | Derek / Operations / Data owner | Planned locations and historical identity require lifecycle | Medium | Yes | Decide minimum creation facts, closure retention, merge and re-open rules |
| Client/location cardinality | Derek / Commercial | Separate boundaries established; cardinality unknown | Low | Yes | Workshop real client/building examples |
| Location Type catalogue | Derek / Operations / domain owners | Candidate archetypes exist; completeness unknown | Medium | Yes for defaulting | Approve initial types and one-versus-many rule |
| Type default capabilities | Domain owners | Thirty-second setup needs sensible defaults | Medium | Yes for setup design | Approve defaults as recommendations only |
| Capability catalogue | Domain owners | Candidate capabilities span current and future operations | Medium | Yes | Approve names, owners, dependencies and optionality |
| Override authority | Derek / Domain owners | Exceptions are necessary but current ownership is fragmented | Medium | Yes | Define who can override type defaults and when |
| Configuration ownership | Derek / Platform / domain owners | Current settings are duplicated across apps | High problem; low final policy | Yes | Approve owner/scope matrix for each item |
| Wise classification | Derek / Operations | Recurring weekly breakfast/lunch without standard till model is confirmed | High evidence | Yes as test case | Confirm one location plus two recurring arrangements |
| The Line classification | Derek / Events owner | Hospitality and future Events roles coexist; historical aliases confirmed | Medium | Yes as test case | Decide primary type and relationship to Event Venue |
| One-day event threshold | Events owner / Derek | One-off venues should not automatically become durable locations | Medium | Yes for Events | Define promotion criteria |
| Provider independence | Derek / Platform | Confirmed principle and Wise evidence | High | No—direction confirmed | Record in future decision |

## Minimum workshop outcome

The Location Business Decision Record can begin after the workshop confirms:

- the canonical object's definition, ownership and lifecycle rules;
- final name;
- client/building cardinality;
- initial location types and classification rule;
- initial capability catalogue and dependencies;
- type-default and override policy;
- configuration ownership/inheritance principles;
- Wise, The Line and one-day-event treatment.

Until then, all recommendations remain provisional.
