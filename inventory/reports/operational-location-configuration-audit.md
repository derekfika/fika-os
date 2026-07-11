# Operational Location and Configuration Audit

## Status and method

This is a read-only audit of local workspace evidence. It inspected architecture/inventory documents, repository/folder structure, project documentation, named configuration keys, and location labels used by applications. It did not call live services or reproduce private IDs, emails, addresses, URLs, credentials, deployment references or customer records.

An application folder, CPU label or provider reference is evidence for review, not proof of a canonical location or lifecycle.

## Summary

Current operational identity is fragmented across:

- `sites/` folder names;
- booking-platform and dashboard names;
- site/location names and short codes in application configuration;
- CPU location-directory labels and Calendar-owner mappings;
- feedback application registrations;
- client-specific tool names;
- browser-side fallback lists;
- planned capabilities documented without repositories.

No single authoritative operational-location register was found. Current mappings mix locations, clients, people, application/demo contexts, former names and presentation attributes.

## Discovered locations and aliases

| Display context | Aliases/evidence | Repository evidence | Classification confidence | Manual review |
|---|---|---|---|---|
| Angel Court | Angel Court; short operational code; CPU and feedback entry | Booking platform and dashboard | Strong operational-location candidate | Confirm client/building relationship, lifecycle and capabilities |
| MNK | MNK; Fika at MNK | Booking platform, dashboard and client portal; CPU/feedback entry | Strong operational-location candidate | Confirm full approved name, client relationship and current capability set |
| CFC | CFC | Booking platform/dashboard; CPU entry | Strong identity evidence; lifecycle confirmed Development | Confirm whether planned operational location or client/site project and opening status |
| The Line | Former 58 Victoria Embankment; `58VE` | Hospitality dashboard under former folder/config name; planned public Events experience | Strong identity with conflicting current/legacy names | Confirm whether Hospitality and Events use one operational location/venue identity |
| Munich RE | Munich RE; short CPU code | Live hot-drinks tally/reporting; CPU entry | Strong recurring/client-operation candidate | Confirm whether managed site, recurring service context or another archetype |
| Wise | Wise | Confirmed business context; no dedicated local application/config entry found | Strong business evidence, weak local configuration coverage | Confirm representation, owner, production/logistics and recurring arrangements |
| Regent Hall | CPU location label | No dedicated local repository found | Candidate only | Confirm identity, client, lifecycle and service pattern |
| Nesta | CPU location label | No dedicated local repository found | Candidate only | Same |
| Zoom | CPU location label | No dedicated local repository found | Candidate only | Same |
| Bridgepoint | CPU label and short code | No dedicated local repository found | Candidate only | Same |
| FIKA Xchange | CPU label and short code | No dedicated local repository found | Candidate only | Confirm whether venue, site, brand or service programme |
| Commerzbank | CPU label and short code | No dedicated local repository found | Candidate only | Confirm identity/lifecycle |
| Funding Circle | CPU label and short code | No dedicated local repository found | Candidate only | Confirm identity/lifecycle |
| Optiver | CPU label and short code | No dedicated local repository found | Candidate only | Confirm identity/lifecycle |
| Witan Gate House | CPU label and short code | No dedicated local repository found | Candidate only | Confirm identity/lifecycle |
| Paternoster Square | Browser-side CPU fallback label | Not found in observed main CPU directory or dedicated repository | Conflicting/projection-only evidence | Confirm active/planned/legacy/test status |
| Demo / Demo Site | Demo application/configuration label | Booking platform/dashboard for sales/tenders | Not a confirmed operational location | Keep outside operational-location register unless business confirms otherwise |
| Two person-name CPU entries | Person names used as CPU “site” entries | CPU configuration only | Not location evidence | Reclassify as owner/calendar/routing data or explain |

Private internal IDs and email mappings exist in configuration but are intentionally not reproduced. Their existence confirms that identity currently depends partly on provider/person mapping.

## Confirmed provider-linked location evidence

| Provider/integration | Confirmed evidence | Location conclusion |
|---|---|---|
| Google Calendar | Hospitality dashboards create events; CPU maps configured Calendar/event-owner context to site labels | Transitional integration only; Calendar/owner identity must not own location identity |
| Gmail | Hospitality legacy intake and notifications use location-specific queries/labels/recipients | Application/adapter configuration, not location identity |
| Drive | Site variants use location-specific roots, quote folders, templates and attachments | AppConfig/file integration metadata; not canonical identity |
| Sheets | Site variants and CPU use separate operational projections/settings | Projection/configuration; not canonical identity |
| BrightHR | Workforce application synchronises employee/absence information | Workforce/provider integration confirmed; no operational-location mapping confirmed |
| Just Eat for Business | Munich RE tools contain branding/reporting clues | Relationship is confirmed as a clue only; exact provider/account/location semantics TODO |

### Square-derived information

Square is confirmed in platform scope as one possible till provider and future abstraction/migration concern. No reliable local Square location directory, Square-to-operational-location mapping, or Square-derived canonical identity was found in the inspected workspace. Text matches in icons or physical place names are not provider evidence.

No confirmed SumUp or Goodtill operational-location mapping was found either.

## Confirmed non-provider-linked operational information

- Wise is a meaningful recurring operational location without assuming any till integration.
- Wise has one breakfast and one lunch service per week, each for approximately 450–500 people.
- Booking/dashboard folders establish location-specific applications independently of till providers.
- CPU production groups demand for more location labels than have dedicated repositories.
- Munich RE is operationally meaningful through live tally/reporting and CPU evidence, irrespective of till status.
- The Line's identity persists despite former venue naming and distinct planned public experience.
- Planned event venues, pop-ups and one-off locations require representation independently of provider presence.

## Likely missing locations or records

- Wise is absent from the observed dedicated site/application and CPU configuration evidence despite confirmed operations.
- CPU-only labels may represent operational locations missing from the application inventory and canonical register.
- Paternoster Square appears only in a fallback list and may be missing from, or obsolete relative to, server configuration.
- Planned locations and pop-up/event locations have no current register.
- Other operations with no dedicated application or till integration may be invisible to repository-based inventory.
- A building/client/venue master register was not found, so duplicate physical or organisational identities cannot be ruled out.

## Conflicting identities

1. **The Line:** approved current name conflicts with former folder/config name and `58VE` code.
2. **MNK:** `MNK`, “Fika at MNK” and client-portal naming coexist.
3. **Site versus client:** several application names use client/site interchangeably.
4. **CPU site directory:** contains location-like labels and person names in one list.
5. **Paternoster Square:** browser fallback and server directory differ.
6. **Demo:** appears as a “site” in demo configuration but is not a confirmed operation.
7. **Location IDs:** dashboard/CPU/site codes and private mapping IDs have no documented shared authority.

## Duplicated configuration

Hospitality dashboard variants repeat or nearly repeat configuration for:

- application/site name and short code;
- default location and time behaviour;
- Calendar settings, attendees, title formats and attachment policy;
- Drive/root/quote folder and template references;
- confirmation recipients and automation enablement;
- printer routing;
- quote/Calendar workflow requirements;
- stale-state highlighting;
- menu, pricing, fee and branding settings across booking/dashboard variants.

CPU separately duplicates display name, short code, colour and owner-email mapping for several of the same contexts. Feedback applications register overlapping site names again. These are strong candidates for governed configuration references after the domain decision, not proof that all values belong on the location aggregate.

## Hardcoded assumptions

- Folder name equates to site identity.
- A Calendar creator/organiser email determines the site.
- Site code and display colour travel together with identity.
- One application variant corresponds to one site/location.
- A default location string can stand in for building, floor, room and delivery point.
- Calendar, Drive, recipient, printer and quote-template configuration is embedded per application.
- CPU location list is treated as a site directory even when entries may be people or routing labels.
- Browser fallback can carry a different site list from server configuration.
- Demo configuration uses site terminology for a non-production context.

These assumptions should be isolated through adapters/configuration during migration, not copied into a future canonical domain.

## Candidate capability flags

The following are candidate independently enabled capabilities, not final schema fields:

| Capability | Evidence level | Notes |
|---|---|---|
| Hospitality booking | Confirmed | Angel Court/MNK live; CFC Development; Demo excluded from production rules |
| Hospitality dashboard | Confirmed | Multiple site variants and The Line |
| Coffee/hot drinks | Confirmed | Munich RE tools |
| Recurring breakfast/lunch | Confirmed | Wise business context |
| CPU demand/production relationship | Confirmed | CPU directory and hospitality flow; production-source boundary TODO |
| Operational reporting | Confirmed | Feedback and Munich RE reporting |
| Quotes/documents | Confirmed | Hospitality dashboards |
| Calendar projection | Confirmed | Hospitality/CPU, but integration not inherent capability identity |
| Workforce planning | Provisionally confirmed | Shared Workforce Platform; site mapping/manual review TODO |
| Events | Planned | The Line/FIKA sites/pop-ups/external venues feed future Events capability |
| Logistics | Planned | Downstream target; current CPU delivery projection is transitional |
| Equipment | Future domain | No location-specific inventory audited |
| Retail | Requested discovery concept | Current operational evidence TODO |
| Brochures/menus | Confirmed hospitality configuration | Capability/config relationship TODO |
| Waste tracking | Unresolved | No confirmed application evidence found in inspected scope |
| Media | Future domain | Current assets/evidence exist; first-class capability not confirmed |
| Mobilisation | Future domain | Planned sites imply need; current process not inventoried |
| Training | Unresolved/future workflow | Workforce roles/config clues are insufficient to establish location capability |

## Recurring service patterns

Wise is the only recurring pattern confirmed with specific business detail: breakfast once weekly and lunch once weekly, each approximately 450–500 people. The stable location should not own each dated occurrence or mutable attendance forecast. Candidate separation:

```text
Operational location: Wise
  -> recurring breakfast arrangement
  -> recurring lunch arrangement
  -> generated service occurrences / production and logistics demand (future)
```

Munich RE's hot-drinks operations are recurring in nature, but cadence, population and operating hours were not confirmed in this task.

## Configuration classification

| Current configuration concept | Recommended classification |
|---|---|
| Name, aliases, lifecycle, provider-neutral ID | Canonical operational-location candidate |
| Capabilities | Capability assignments with versions/effective dates |
| Client reference | `FikaClient` relationship |
| Brand reference/allowed override | `FikaBrand` relationship/configuration |
| Address/building | Building/address domain data |
| Floor/room/service/delivery point | Service-location detail |
| Service cadence/population/window | Recurring service arrangement |
| Calendars, folders, email recipients, printers | `FikaAppConfig`; values may be private |
| Menus, pricing and fees | Catalogue/pricing policy plus `FikaAppConfig` references |
| Provider account/location IDs and sync status | External-provider integration metadata |
| Tokens/credentials/private connection details | Secret/private configuration |
| CPU display colour/site code | Operational projection or safe display configuration |
| Calendar-owner email site inference | Legacy adapter mapping |
| Event venue/pop-up record | Event domain unless promoted by business rule |
| Workforce, equipment, media, mobilisation, training records | Separate future domains; location references them |

## Unknown ownership

- operational-location identity and lifecycle owner;
- client/location relationship owner;
- capability approval owner;
- CPU site-directory maintainer;
- recurring-service schedule/population owner;
- Calendar/Drive/recipient/printer/menu/pricing configuration owners;
- provider mapping and till migration owner;
- brand/white-label override owner;
- building/service-point data owner;
- retention/security owner for contacts and provider mappings.

## Migration risks

- Assigning new IDs without a reviewed alias/source map could split or merge real operations incorrectly.
- Treating all CPU labels as locations could promote people, routing labels or stale entries.
- Treating repository folders as the complete inventory would omit Wise and other service-only contexts.
- Treating client, building or provider identity as location identity would break future cardinality and migrations.
- Moving configuration before ownership/default/override rules are approved could change live behaviour.
- Renaming The Line without preserving historical aliases could break source matching and reporting.
- Consolidating repeated site configuration too early could erase genuine workflow differences.
- Provider migration could fragment history if provider IDs remain primary keys.
- Event/pop-up promotion without a threshold could create excessive or duplicate location records.
- Recurring service patterns embedded directly into location records could make amendments/history unclear.

## Audit conclusion

The workspace contains enough evidence for a structured business workshop and a provisional recommendation of `FikaOperationalLocation`. It does not contain enough authoritative lifecycle, ownership, client/building cardinality, provider mapping or recurring-service policy to create a schema.

The next safe step is to complete `docs/business-workshops/operational-location-workshop.md`, verify the CPU-only labels with Operations, add Wise and other repository-invisible operations to a confirmed register, and decide the domain boundary before drafting a model.
