# Operational Location Domain Discovery

## Status and evidence boundary

This is read-only domain discovery based on confirmed business context, the FIKA architecture repository, repository/folder structure, project documentation, and local configuration patterns. It does not define or adopt a schema, migrate configuration, select a provider, or assert production lifecycle where evidence is incomplete.

Private IDs, addresses, email addresses, URLs, credentials, deployment references and sensitive operational identifiers are deliberately omitted.

## Plain-English candidate definition

A **FIKA operational location** is a stable business context in which FIKA repeatedly or deliberately plans, delivers, manages or reports an operational service, regardless of whether FIKA controls the building, operates every day, has a till integration, or has a dedicated application.

It may represent a standard managed site, a recurring client service, a long-running venue operation, a temporary pop-up context, or a planned operation. It supplies identity and capability context; it does not replace the client, brand, building, room/delivery point, event venue, recurring service schedule, application configuration or provider integration.

This definition is provisional and exists to support the business workshop.

## Recommended working name

Use **`FikaOperationalLocation` as the working domain name**, not as an adopted schema name.

The evidence favours this term because it:

- includes standard managed sites and Wise's recurring weekly service;
- does not require a till relationship;
- can exist before opening or without a dedicated repository;
- can host independent capabilities such as hospitality, reporting, workforce or events;
- avoids confusing a stable operating context with a building, room, delivery point or one event venue;
- preserves `FikaServiceLocation` for the specific place where a service is delivered.

Final naming remains a Derek/business-owner decision.

## Evidence for and against candidate names

| Name | Evidence for | Evidence against | Recommendation |
|---|---|---|---|
| `FikaSite` | “Site” is established throughout folders, application settings, current `siteId` usage and operational language. It is concise and familiar for standard managed operations. | It suggests permanence, a physical premises or conventional managed-site model. Wise, temporary pop-ups, recurring services and some event contexts do not fit comfortably. Existing code also uses “site” for Calendar-owner mappings and display groups that include non-site labels. | Retain as current terminology and possible user-facing label, but do not adopt as the canonical domain name without workshop confirmation. |
| `FikaLocation` | Broad enough for physical venues, buildings, pop-ups and delivery contexts. | Too broad: current evidence already distinguishes building, floor, room/area, delivery point, external address and service location. It risks making every room or one-off venue a canonical operating entity. | Avoid as the unqualified aggregate name. Reserve “location” for general physical/place concepts. |
| `FikaOperationalLocation` | Describes the stable operating context rather than ownership, permanence or provider. Fits managed sites, recurring client services, planned operations and capability assignment. | Longer, and the threshold between an operational location and a one-off event venue still requires policy. “Operational” may sound internal when some contexts are client-facing. | Recommended working name for the workshop. |
| `FikaOperatingContext` | Emphasises non-physical business context and could include recurring arrangements. | Too abstract for operational users and may blur client, contract and service-arrangement boundaries. | Do not prefer unless the workshop finds location language consistently misleading. |

## Confirmed and evidenced archetypes

| Archetype | Evidence | Modelling implication |
|---|---|---|
| Standard managed site | Angel Court and MNK have site-specific booking/dashboard applications and substantial configuration. CFC is a built Development variant. | Stable operational identity with independently enabled capabilities and configuration. |
| Recurring service location | Wise is confirmed to receive one breakfast and one lunch service weekly for approximately 450–500 people per service, outside the standard till-location model. | Operational location may exist without till, dedicated application or daily presence. The schedule/population belongs primarily to a recurring service arrangement. |
| Long-running client-specific operational location | Munich RE has confirmed live client-specific hot-drinks tally/reporting and appears in CPU location mapping. | Client relationship, reporting capability and provider/brand clues are separate from location identity. |
| Hospitality/event venue operation | The former 58 Victoria Embankment configuration and folder must be referred to as The Line; it has a hospitality dashboard and planned separate public experience. | One operational identity may have historical aliases and both hospitality/event capabilities; venue/event records remain separate. |
| Event venue | Events scope includes FIKA sites, The Line and external venues. | A frequently managed venue might later qualify as an operational location; a one-off event venue normally remains in Event/Venue unless approved otherwise. |
| Temporary pop-up | FIKA Events and Pop-ups is a confirmed future public capability. | A pop-up may use a temporary operational location only when it needs stable configuration/operations beyond one event. |
| External event location | Confirmed future Events input category. | Default to Event/Venue/service-location detail; promote only under an explicit threshold. |
| Planned location | Site provisioning and mobilisation are planned platform concerns. | Allow identity/lifecycle before opening without pretending capabilities or integrations are live. |
| Demonstration context | Demo booking/dashboard applications exist for sales/tenders. | Demo is application/test configuration, not evidence of a real operational location. |

## Discovered operational-location evidence

### Repository-backed or confirmed contexts

- **Angel Court** — booking platform and dashboard; CPU and feedback mappings; short-code alias exists.
- **MNK / Fika at MNK** — booking platform, dashboard and client portal; CPU and feedback mappings.
- **CFC** — booking platform and dashboard; confirmed Development, built but not operationally deployed.
- **The Line** — current approved name for the former 58 Victoria Embankment; local folder/configuration still uses the former name and `58VE` alias.
- **Munich RE** — live client-specific hot-drinks tally/reporting; CPU location entry; Just Eat for Business branding/reporting clue exists, but relationship details are TODO.
- **Wise** — confirmed recurring breakfast/lunch service location with no assumption of till integration; no dedicated local application/configuration entry was found.

### CPU-directory-only location labels requiring confirmation

The CPU location directory includes: Regent Hall, Nesta, Zoom, Bridgepoint, FIKA Xchange, Commerzbank, Funding Circle, Optiver and Witan Gate House. These labels influence production grouping/site resolution, but do not confirm client relationship, lifecycle, address, till status, ownership or whether each should become a canonical operational location.

A Paternoster Square label also appears in a browser-side CPU fallback list but not the main server directory observed. This conflict requires review.

Two person-name entries appear in the CPU site directory. They are not safe evidence of operational locations and should be separated or explained before migration.

### Aliases and conflicts

- The Line ↔ former 58 Victoria Embankment ↔ `58VE`.
- Angel Court has a short operational code alias.
- Munich RE has a short operational code alias.
- MNK appears as both `MNK` and “Fika at MNK” in application naming.
- FIKA Xchange includes a product/venue-style label whose precise client/building relationship is TODO.
- Demo/Demo Site is a non-production application context, not a confirmed location.
- Folder names, CPU display labels/codes, application names and client labels currently act as competing identity hints; private internal IDs also exist but are not reproduced.

## Capability-based modelling

Capabilities should be independently enabled for an operational location, with ownership and configuration references rather than a fixed “site type” that assumes every service.

Candidate capabilities evidenced or requested include:

- hospitality booking;
- hospitality dashboard/operations;
- coffee/hot-drinks operation;
- retail;
- events;
- recurring breakfast service;
- recurring lunch service;
- CPU production demand or production source;
- logistics;
- workforce planning;
- equipment;
- operational/client reporting;
- quotes and documents;
- brochures/menu publication;
- waste tracking;
- media;
- mobilisation;
- training.

Capability presence should not imply a provider integration. A location may use hospitality and reporting with no till. A provider link may exist without determining the operational-location ID.

## Concept classification

| Field or concept | Classification | Guidance |
|---|---|---|
| Stable operational-location ID | Canonical operational-location candidate | Provider-neutral, immutable identity; exact rules TODO. |
| Current name and approved aliases | Canonical operational-location candidate | Preserve former names separately; display name is not identity. |
| Lifecycle: planned/development/active/paused/legacy | Canonical operational-location candidate | Final vocabulary/transition owner TODO. Application lifecycle remains separate. |
| Archetype/classification | Canonical operational-location candidate | Use cautiously; capabilities may be more useful than one rigid type. |
| Client relationship | FikaClient | Operational location references a client; client identity/details live separately. Cardinality TODO. |
| Brand selection | FikaBrand | Reference effective brand; brand definitions/assets live separately. |
| Building/address | Building or physical-address data | Physical place may be shared by several operating contexts. Ownership and master data TODO. |
| Floor, room, service point, delivery point | Service-location detail | Belongs to structured service location or child location catalogue, not the aggregate identity. |
| Hospitality, coffee, events, reporting, workforce, equipment | Capability | Independently enabled; policy/configuration referenced separately. |
| Weekly breakfast/lunch pattern and expected attendance | Recurring service arrangement | Wise demonstrates this boundary. Do not freeze recurring schedule/population into location identity. |
| Service days, service windows, operating pattern | Recurring service arrangement | Could vary by service/season; location may supply defaults only after decision. |
| Event venue for one event | Separate future domain | Normally Event/Venue; promote only when persistent operational management/configuration warrants it. |
| Pop-up lifecycle and programme | Separate future domain | Events/Mobilisation; an operational-location reference may be created when needed. |
| Booking/dashboard/portal enablement | Capability | Application-specific settings are separate. |
| Calendar, folders, recipients, printers, menus, prices, fees | FikaAppConfig | Some values may be site-scoped configuration; exact ownership per key required. IDs/addresses may be private. |
| Logo, colours, typography, white-label rules | FikaBrand | Location selects/overrides only as brand policy permits. |
| Provider location/account IDs | External-provider integration metadata | Optional mapping keyed to canonical location; never identity. |
| Provider credentials/tokens/private endpoints | Secret/private configuration | Never canonical or exposed. |
| Calendar owner email used to infer site | Legacy field | Transitional mapping; person/provider address must not define identity. |
| CPU site code/colour and dashboard row grouping | Operational projection | Useful display/grouping; reconcile to canonical identity later. |
| Application folder name | Legacy field | Evidence/alias only; not canonical identity. |
| Site/account manager and operational contacts | Unresolved | Likely scoped role/assignment or User/Client relationship, not embedded free text. |
| Suppliers | Separate future domain / FikaAppConfig | Supplier identity/contract likely separate; simple enabled references may be configuration. Discovery needed. |
| Production source | Unresolved | Likely relationship to another operational location/production facility or Production configuration. |
| Mobilisation/training status | Separate future domain | Location may expose capability/readiness summary as projection. |
| Just Eat for Business status | External-provider integration metadata | Relationship is optional and currently only partially evidenced. |
| BrightHR relationship | External-provider integration metadata | Workforce-level/provider context; no evidence it owns location identity. |

## Boundary recommendations

### Operational location versus client

The client is the commercial/organisational party. The operational location is where or under which context FIKA operates. One client may plausibly have several operational locations, but this is not yet confirmed as policy. Do not duplicate client contacts/branding into every location except deliberate snapshots or assignments.

### Operational location versus brand

The location selects a brand context and allowed override references. FIKA/client brand assets and rules are owned by Brand Service. A brand may serve many locations; a location identity survives rebranding.

### Operational location versus building/address

A building is a physical entity/address. An operational location may occupy a building, share it, move, or represent recurring service without FIKA control of the premises. Do not make address the stable identity.

### Operational location versus service location

The operational location is the durable operating context. A service location is the precise delivery/collection/room/floor/service point for a booking, production handover or event. Many service locations may belong to one operational location.

### Operational location versus event venue

An event venue belongs primarily to Events/Venue when it exists for an event or enquiry. Create/link an operational location only when FIKA needs persistent capability, configuration, reporting or recurring operational ownership beyond the event.

### Operational location versus recurring service

The location states the durable context; a recurring service arrangement owns service type, days, cadence, expected attendance/population, seasonal validity, production source and logistics pattern. Wise should therefore be one operational location linked to at least breakfast and lunch recurring-service definitions, subject to workshop confirmation.

### Operational location versus provider integration

Provider integrations are optional mappings from the canonical operational-location ID to provider account/location references, capabilities and sync state. None may create or own canonical location identity.

### Operational location versus application configuration

The location owns identity, lifecycle and capability selection. AppConfig owns calendars, folders, recipients, printers, menus, pricing policies, fees, enabled application behaviour and provider connection references at appropriate scopes.

## Risks of provider-centred modelling

- Excludes Wise and any operation with no till.
- Confuses a provider's account/location hierarchy with FIKA's operating model.
- Breaks identity during provider migration.
- Prevents one operational location from using multiple providers for different capabilities.
- Makes temporary, planned, event and recurring-service contexts hard to represent.
- Encourages provider IDs, status and credentials to leak into canonical records.
- Causes reporting history to fragment when integrations change.
- Treats missing integration as missing location rather than a legitimate capability choice.

## Open business questions

- What minimum operational commitment makes a venue/service context an operational location?
- Can one client own or sponsor several operational locations? Can one location serve several clients?
- Can one building contain several operational locations, and can one location span buildings?
- Which CPU directory labels are genuine locations, clients, people, calendars or temporary groupings?
- Is Paternoster Square active, planned, legacy or only a browser fallback?
- What are the approved lifecycle states and owners?
- Which capabilities are independent, mutually dependent or inherited?
- Who owns recurring-service arrangements, population forecasts and service calendars?
- Who owns operational-location configuration and changes?
- Which contacts are role assignments rather than location fields?
- When does a temporary event/pop-up receive a persistent operational-location identity?
- What is the exact relationship between Munich RE and Just Eat for Business?
- Which locations, if any, currently use Square, SumUp, Goodtill or no till?
- What retention and access rules apply to provider mappings and operational contacts?

## Discovery conclusion

There is enough evidence to run the operational-location decision workshop and to reject provider-centred identity. There is not enough evidence to create a schema or adopt the final name. The workshop should first confirm archetype thresholds, client/building cardinality, capability ownership, recurring-service boundaries, lifecycle and the real status of CPU-only labels.
