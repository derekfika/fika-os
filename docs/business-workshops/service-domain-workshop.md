# FIKA Service Domain Workshop

> **Classification: Historical discovery evidence.** This workshop fed the completed business-discovery process. Open rows are not a current backlog and are superseded where the canonical decision register differs.

## Purpose

This workshop decides the meaning and boundary of a FIKA Service. It is pre-filled only with confirmed evidence and explicit proposals. It does not create a schema or adopt policy.

Status values: `Open`, `Confirmed evidence`, `Recommended`, `Needs evidence`, `Not applicable`.

## Questions for Derek

These are platform-wide boundary decisions that require Derek's direction.

| Question | Why it matters | Example | Pre-filled evidence | Decision owner | Status | Final answer | Confidence | Notes |
|---|---|---|---|---|---|---|---|---|
| What should “Service” mean in plain English? | Every domain and application needs the same basic meaning. | MNK Hospitality or Wise Monday Breakfast | Proposed: a defined offering or piece of work FIKA provides at, from or through a location. | Derek | Open |  | Medium-high | Decide whether internal services are included. |
| Should Service describe a durable offering rather than one dated delivery? | Prevents schedules, bookings and occurrences being mixed into identity. | Wise Monday Breakfast versus one specific Monday | Evidence supports a reusable/configured arrangement plus dated occurrences. | Derek | Recommended |  | High |  |
| Does Service include internal work such as CPU production? | Determines whether Service becomes too broad. | “Production Service” | ADR-004 places production in its own domain; treating it as Service is unconfirmed. | Derek / Production owner | Open |  | Medium | Recommendation: keep downstream Production separate unless business treats it as an offered service. |
| Can a Specific Service exist before a location is assigned? | Needed for reusable offerings and planned launches. | Coffee Cart template | Templates clearly can; location-specific Service policy is open. | Derek | Open |  | Medium |  |
| Can one Specific Service operate at many locations? | Determines identity and assignment model. | Coffee Cart or shared hospitality offer | Reusable templates can span locations; specific-service cardinality is unconfirmed. | Derek | Open |  | Medium |  |
| Is Coffee Cart a reusable Service Template? | Avoids making the cart or each deployment a location. | Coffee Cart Pop-up | Confirmed as reusable offering across locations. | Derek / Events / Coffee owner | Recommended |  | High | Equipment relationship remains separate. |
| Should applications and integrations be removed from capability/service catalogues? | Prevents software choices defining business meaning. | Dashboard, Calendar, provider connection | Platform principles confirm applications consume domains and providers are adapters. | Derek / Platform | Confirmed direction |  | High | Approve corrections to location documents. |
| Is there enough evidence to begin a Service Business Decision Record after this workshop? | Controls the next architecture gate. | Service definition and recurrence decisions | Discovery identifies blocking questions and owner routes. | Derek | Open |  | High | No schema follows automatically. |

## Questions for Operations

| Question | Why it matters | Example | Pre-filled evidence | Decision owner | Status | Final answer | Confidence | Notes |
|---|---|---|---|---|---|---|---|---|
| Are Wise Breakfast and Wise Lunch two Services or one Service with two schedules? | Sets the identity test for recurring offerings. | Monday Breakfast and Friday Lunch | They differ by offering and day; both serve approximately 450–500 people. | Operations owner | Open |  | High evidence; medium recommendation | Recommendation: two services unless they cannot change independently. |
| Can one be paused, repriced or ended without the other? | Independent change is strong evidence of separate identity. | Pause Friday Lunch only | No policy recorded. | Operations / Commercial | Open |  | Low |  |
| Should a Service have zero, one or several schedules? | Avoids recurrence being a single fixed flag. | Seasonal service with weekday and exception pattern | Multiple schedules are plausible; no approved policy. | Operations | Open |  | Medium |  |
| Can a schedule change while Service identity remains? | Protects history when delivery day/time changes. | Friday Lunch moves to Thursday | Working recommendation: yes, if offering/arrangement remains the same. | Operations | Recommended |  | Medium-high |  |
| Does a recurring service need a start date and optional end date? | Defines contract/operational validity. | Wise recurring arrangement | No dates confirmed, but effective period is operationally necessary. | Operations / Commercial | Open |  | Medium |  |
| How are holidays, pauses, replacements and cancelled occurrences handled? | Required for reliable production/labour/logistics. | Bank-holiday Monday | No current canonical policy. | Operations | Open |  | Low |  |
| Should each scheduled occurrence create a Booking? | Booking should not be invented where there is no customer request. | Wise weekly delivery | Confirmed recurring work; Booking requirement is unknown. | Operations / Commercial / Finance | Open |  | Medium | Consider separate Service Occurrence. |
| Who owns expected attendance and changes? | CPU quantities and labour/logistics depend on it. | Wise 450–500 people | Approximate attendance is confirmed, ownership is not. | Operations | Open |  | High evidence |  |
| Can a service be paused without closing its location? | Separates Service lifecycle from Location lifecycle. | Pause Coffee Bar while MNK remains open | Domain boundaries support this; policy unconfirmed. | Operations | Recommended |  | High |  |
| What makes a Service the same after menu, schedule or fulfilment changes? | Defines stable identity. | New menu, same MNK Hospitality | No identity rule approved. | Operations / Commercial | Open |  | Low | Blocking. |

## Questions for Events

| Question | Why it matters | Example | Pre-filled evidence | Decision owner | Status | Final answer | Confidence | Notes |
|---|---|---|---|---|---|---|---|---|
| What qualifies a Service deployment as an Event? | Keeps reusable offering separate from event lifecycle. | Coffee Cart at a corporate activation | Event is a separate qualifying lifecycle; qualification rules are not defined. | Events owner | Open |  | Medium |  |
| Is “The Line Events” a Service offer, a group of Events or both? | Prevents venue offering and individual events being conflated. | The Line public experience feeding Events Dashboard | Separate public experience and shared internal Events authority are confirmed. | Events owner | Open |  | High evidence |  |
| Should each Coffee Cart deployment create an Event? | Determines operational tracking. | One-day pop-up | Coffee Cart is reusable across locations; deployment rule is open. | Events owner | Open |  | Medium | Some deployments may be occurrences rather than qualifying events. |
| Is Coffee Cart primarily Coffee Service, Pop-up Service or named template? | Sets catalogue structure. | Coffee Cart Activation | Evidence favours a named reusable template; type/family is open. | Events / Coffee owner | Open |  | Medium-high |  |
| When does an external venue become a canonical Location? | Prevents excessive location creation. | One-off corporate event | Existing Location workshop recommends a persistence threshold. | Events owner / Derek | Open |  | Medium | Coordinate with Location decision. |
| Are Event packages and add-ons owned by Service, Event or a separate catalogue? | Affects reuse and commercial versioning. | Canapé/event package | Future Events/package concepts exist; ownership not decided. | Events / Commercial | Open |  | Low |  |

## Questions for CPU / Production

| Question | Why it matters | Example | Pre-filled evidence | Decision owner | Status | Final answer | Confidence | Notes |
|---|---|---|---|---|---|---|---|---|
| What Service information is genuinely required before production work can be created? | Keeps Production separate while providing enough planning context. | Wise Breakfast or hospitality booking | Production needs ordered units, timing, location and dietaries from demand; service-level requirements remain unconfirmed. | Production owner | Open |  | Medium |  |
| Is CPU production itself a Service? | Determines scope of Service domain. | Internal central production | ADR-004 treats Production as its own domain downstream of Booking. | Production owner / Derek | Open |  | High architecture evidence | Recommendation: no unless offered/managed as a distinct service. |
| Does production source belong to the Service or each occurrence/order? | Source may vary temporarily. | Wise food produced at CPU | Current source is not canonically modelled. | Production / Operations | Open |  | Low | Could be default plus occurrence override. |
| Which recurring changes require new production work? | Needed for safe schedule exceptions and amendments. | Attendance or menu change | Current CPU path is Calendar-led and lacks canonical recurrence. | Production / Operations | Open |  | Medium |  |
| When should labour/equipment/logistics requirements be defaults versus occurrence-specific? | Avoids stale requirements. | Coffee Cart activation | Requirements may vary by deployment. | Production / Logistics / Workforce | Open |  | Medium |  |

## Questions for Finance / Commercial

| Question | Why it matters | Example | Pre-filled evidence | Decision owner | Status | Final answer | Confidence | Notes |
|---|---|---|---|---|---|---|---|---|
| Does a Specific Service belong to a client, location or both? | Determines commercial ownership and reuse. | Wise recurring services versus Coffee Cart template | Separate Client/Location boundaries exist; cardinality is undecided. | Commercial owner | Open |  | Medium | Blocking. |
| Can one Service Template be used by many clients? | Enables reuse without sharing commercial terms. | Coffee Cart template | Reusable offering strongly suggests yes; policy unconfirmed. | Commercial owner | Open |  | Medium-high |  |
| Who owns Service pricing? | Prevents service definitions and booking snapshots drifting. | Wise contract rate, hospitality catalogue price | Booking freezes pricing; pricing policy ownership remains unresolved. | Finance / Commercial | Open |  | High evidence |  |
| Are contract terms part of Service or separate configuration/contract? | Keeps identity stable when terms change. | Wise effective term | Architecture favours separate commercial configuration/reference. | Finance / Commercial | Recommended |  | Medium |  |
| Must every recurring occurrence create a commercial Booking? | Affects invoicing, reporting and audit. | Wise Monday Breakfast | Operational occurrence is confirmed; commercial representation is not. | Finance / Commercial | Open |  | Low | Blocking. |
| Who owns menus, packages and add-ons commercially? | Defines versioning and price responsibility. | Hospitality menu or Coffee Cart package | Current catalogues are site/application specific. | Commercial / Hospitality / Events | Open |  | Medium |  |

## Questions for Marketing / Brand

| Question | Why it matters | Example | Pre-filled evidence | Decision owner | Status | Final answer | Confidence | Notes |
|---|---|---|---|---|---|---|---|---|
| Can one Service Template have approved brand variants? | Supports reuse without copying business identity. | FIKA versus client-branded Coffee Cart | Brand System supports governed client/site/experience variants. | Brand / Marketing owner | Open |  | Medium |  |
| Who owns the public service name and description? | Separates customer-facing copy from stable identity. | Coffee Cart Activation name | Brand/content and domain identity are separate; no owner confirmed. | Marketing / Service owner | Open |  | Medium |  |
| Are menus/packages content, catalogue or media? | Avoids presentation files becoming source of truth. | Brochure/menu imagery and copy | Current menu/brochure data is in scope; ownership is fragmented. | Marketing / Commercial / Hospitality | Open |  | Medium |  |
| How should seasonal offers retain identity? | Allows copy/assets to change without losing history. | Seasonal Coffee Cart package | Seasonal services/templates are plausible; no policy exists. | Marketing / Commercial | Open |  | Low |  |

## Questions for Workforce / HR

| Question | Why it matters | Example | Pre-filled evidence | Decision owner | Status | Final answer | Confidence | Notes |
|---|---|---|---|---|---|---|---|---|
| Does Service own labour requirements or only reference them? | Workforce should own people and assignments. | Wise allocated labour | Recommendation: Service holds requirement/default; Workforce owns allocation. | Workforce / Operations | Open |  | Medium |  |
| Can labour patterns be scheduled independently from Service recurrence? | Staffing may differ by occurrence/season. | Wise holiday week or Coffee Cart event | No canonical policy. | Workforce / Operations | Open |  | Low |  |
| Is Training a Service family, workforce workflow or separate domain? | Prevents premature capability/domain assignment. | Training Centre / Training Service | No confirmed operational example. | Workforce/HR / Training owner | Needs evidence |  | Low |  |
| Who may view service-linked staffing and client details? | Permissions/privacy must be explicit. | Labour assignment at client location | Permission model is conceptual; real roles/privacy policy missing. | Workforce/HR / Security | Open |  | Medium |  |
| Can a Service exist with no permanent team? | Avoids managed-site staffing assumptions. | Wise | Confirmed: Wise has no permanent team. | Workforce/HR | Confirmed evidence |  | High | Labour is allocated per need. |

## Workshop decision summary

| Decision | Primary owner | Blocking? | Current recommendation | Final answer |
|---|---|---|---|---|
| Service definition and scope | Derek / Operations | Yes | Durable offering/operating arrangement, not dated occurrence |  |
| Internal versus customer-facing Service scope | Derek / Production/Operations | Yes | Keep Production separate unless explicitly treated as offered service |  |
| Specific Service client/location cardinality | Commercial / Derek | Yes | Allow explicit relationships; do not infer |  |
| Recurrence model | Operations | Yes | One Service may have one or more versioned schedules |  |
| Booking versus Service Occurrence | Operations / Finance / Commercial | Yes | Do not create Booking automatically without commercial need |  |
| Wise identity | Operations / Commercial | Yes | Two services unless they cannot change independently |  |
| Coffee Cart model | Events / Coffee / Equipment | Yes | Reusable Service Template plus deployment occurrence/Event |  |
| Event qualification | Events | Yes | Event remains separate lifecycle |  |
| Menu/package/pricing ownership | Commercial / Domain owners | Yes | Separate versioned relationships |  |
| Location catalogue corrections | Derek / Location workshop | Yes before Location decision | Apply approved corrections only after workshop |  |

## Completion gate

There is enough evidence to run this workshop now. A Service Business Decision Record should be created only after blocking rows have named owners and final answers. No schema should be created from unanswered recommendations.
