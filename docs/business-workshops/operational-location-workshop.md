# Operational Location Business Workshop

## Purpose

Use this workshop to decide the business meaning and name of the future operational-location domain before schema design. Pre-filled evidence is limited to confirmed context and local repository evidence. Blank final answers are intentional.

Status values: `Open`, `Confirmed`, `Needs evidence`, or `Not applicable`.

| Question | Pre-filled evidence | Decision owner | Status | Final answer | Notes |
|---|---|---|---|---|---|
| What kinds of FIKA operational locations exist? | Evidence supports managed hospitality sites, recurring client services, client-specific reporting operations, hospitality/event venue operations, planned event venues/pop-ups and planned locations. | Derek / Operations | Open |  | Confirm minimum set and vocabulary. |
| Is `FikaOperationalLocation` the right domain name? | “Site” is established but narrow; “Location” conflicts with rooms/delivery points; “Operational Location” includes Wise and provider-free contexts. | Derek | Open |  | Working recommendation only. |
| Can one client have several operational locations? | Client and site labels are separate in some current applications; no approved cardinality was found. | Derek / Commercial | Open |  |  |
| Can one operational location serve several clients? | No confirmed policy found. External venues/pop-ups may create this need. | Derek / Commercial | Open |  |  |
| Can one building contain several FIKA operational locations? | Current service-location modelling separates building/floor/room from site identity; actual cardinality is unconfirmed. | Derek / Operations | Open |  |  |
| Can one operational location span several buildings or move address? | Provider-neutral identity and storage independence support this possibility; no confirmed example found. | Derek / Operations | Open |  |  |
| Can a location exist without a till? | Yes. Wise is confirmed outside the standard till-location model. | Derek | Confirmed |  | Final answer should confirm whether this is universal policy. |
| Can a location exist only for recurring weekly services? | Wise receives one breakfast and one lunch service weekly, each for approximately 450–500 people. | Derek / Operations | Confirmed evidence |  | Decide whether this creates one location plus two arrangements. |
| How should Wise be represented? | Meaningful recurring operational context; no dedicated local application entry found; till must not define identity. | Derek / Operations | Open |  | Recommended: operational location plus breakfast/lunch recurring-service arrangements. |
| Which details belong to Wise's recurring service rather than its location? | Confirmed cadence, meal types and approximate attendance vary as service-pattern facts. | Derek / Operations | Open |  | Decide validity dates, service windows, production and logistics ownership. |
| Can a temporary event or pop-up become an operational location? | Pop-ups and temporary/event contexts are confirmed future scope; no threshold is approved. | Events owner / Derek | Open |  |  |
| When should an event venue remain only in the Event domain? | Current recommendation: one-off venue remains Event/Venue unless persistent configuration/reporting/ownership is needed. | Events owner / Derek | Open |  | Define promotion threshold and deduplication. |
| How should planned sites be represented before opening? | Mobilisation and planned site provisioning are future concerns; lifecycle must not imply live capability. | Derek / Mobilisation owner | Open |  | Decide planned/development/readiness distinction. |
| What are the approved location lifecycle states? | Requested candidates include active, planned, development, paused and legacy; application lifecycle currently uses Live/Pilot/Development/Planned/Archived. | Derek / Operations | Open |  | Location and application lifecycles should not be conflated. |
| Which capabilities are enabled independently? | Evidence supports hospitality booking/dashboard, coffee/hot drinks, events, production demand, workforce, equipment, reporting, quotes/documents and recurring services; other requested capabilities need confirmation. | Derek / Domain owners | Open |  | Mark dependencies separately from capability presence. |
| Are breakfast and lunch capabilities or recurring service types? | Wise evidence describes recurring services; a capability flag alone would lose cadence/population. | Derek / Operations | Open |  | Recommendation: service arrangements under an enabled recurring-catering capability. |
| Does CPU production create an operational location, or link locations to a production facility? | CPU groups demand by site labels; production source/facility ownership is not modelled canonically. | CPU/Operations owner | Open |  |  |
| Which current CPU directory entries are genuine operational locations? | Location-like labels include Angel Court, Munich RE, CFC, Regent Hall, Nesta, 58VE, Zoom, MNK, Bridgepoint, FIKA Xchange, Commerzbank, Funding Circle, Optiver and Witan Gate House. Two person names also appear. | Derek / CPU Operations | Needs evidence |  | Review each without relying on existing IDs. |
| What is Paternoster Square's status? | Appears in a browser-side CPU fallback but not the observed main server directory. | Derek / CPU Operations | Needs evidence |  | Active, planned, legacy, duplicate or test? |
| Is Demo ever an operational location? | Demo applications are confirmed for sales/tenders, not production operations. | Derek | Open |  | Recommended default: no; retain as application/test context. |
| How should The Line aliases be retained? | Approved current name is The Line; folder/config still use former 58 Victoria Embankment and `58VE`. | Derek / Events owner | Open |  | Preserve historical alias without exposing it as current display name. |
| What is the relationship between a location and a client? | Current applications mix site/client naming; architecture requires separate FikaClient boundary. | Derek / Commercial | Open |  | Decide owner/sponsor/contract relationships and effective dates. |
| What information is inherited from a client? | No approved inheritance policy found. | Derek / Commercial | Open |  | Contacts, commercial terms and brand should not be copied implicitly. |
| What information is inherited from a brand? | FIKA Core Brand System defines governed brand selection and allowed overrides. | Brand owner: TODO | Open |  | Decide default/co-brand/white-label per location. |
| Who owns location configuration? | Current values are duplicated across application code/settings; no single owner is confirmed. | Derek / Operations / Platform | Open |  | Define proposer, approver and emergency-change roles. |
| Which values belong to location versus AppConfig? | Identity/lifecycle/capabilities are location candidates; calendars, folders, recipients, printers, menus, prices, fees and app enablement are configuration. | Derek / Platform | Open |  | Confirm ownership per configuration key. |
| Which information must never be hardcoded in applications? | Private IDs, credentials, recipients, provider mappings, location identity, capability policy and mutable operational configuration should be governed externally. | Derek / Platform | Open |  | Safe brand/content defaults may be committed under policy. |
| How are operational contacts represented? | Manager/contact fields were requested, but current email/owner mappings mix identity and routing. | Derek / Operations / Security | Open |  | Prefer scoped role assignments over free-text identity. |
| Which locations have a till integration? | No reliable local Square/SumUp/Goodtill location mapping was found. Wise is confirmed not to depend on the standard till model. | Derek / Finance/Retail | Needs evidence |  | Inventory provider mappings separately. |
| Can one location use several providers? | Architecture requires optional provider mappings and does not prohibit it; no confirmed example found. | Derek / Platform | Open |  | Decide per capability and effective dates. |
| What is Just Eat for Business status? | Munich RE hot-drinks applications contain branding/reporting clues; exact relationship and whether it is a provider integration are unconfirmed. | Derek / Munich RE owner | Needs evidence |  |  |
| Is BrightHR linked to locations or only workforce identity? | Workforce application contains BrightHR employee/absence sync; no canonical location mapping was confirmed. | Workforce owner: TODO | Open |  |  |
| Which service points, rooms and delivery points require stable IDs? | Hospitality and CPU evidence uses building/floor/room/delivery labels; current mapping is inconsistent. | Operations / Logistics | Open |  | Keep below operational-location aggregate unless promoted. |
| What are retention/access rules for provider mappings and contacts? | No confirmed policy found. | Security/Data owner: TODO | Open |  | Required before adoption. |

## Workshop output required

The workshop should produce:

1. approved domain name and plain-English definition;
2. archetype threshold and event/pop-up promotion rule;
3. client/building/location cardinalities;
4. location lifecycle and ownership;
5. capability catalogue and dependencies;
6. recurring-service boundary using Wise as the test case;
7. confirmed current location/alias register;
8. configuration ownership/inheritance matrix;
9. optional provider-mapping policy;
10. explicit approval or rejection to begin a draft domain model—still before schema creation.
