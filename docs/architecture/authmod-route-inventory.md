# AUTHMOD route and access inventory (Phase A)

Status: source inventory from checkpoint d878071; target classifications are proposed and must be confirmed during implementation. Current describes observed route protection, not an authorization recommendation.

## Legend

- **Public**: intentionally unauthenticated customer/landing route.
- **Human**: central employee session plus app/action/scope decision.
- **Service**: named service principal; no human app grant required.
- **Bridge**: dedicated existing integration credential, to be migrated to a service principal.
- **Dev**: local synthetic fallback only; must not survive production.

## Integration Hub

| Route family | Methods | Function | Current | Target |
|---|---|---|---|---|
| /api/auth/session | GET/POST/DELETE | local synthetic login/session/logout | Firebase emulator token + email role | Human identity/session boundary; POST role selector removed in production |
| /api/hub, /api/hub/progress | GET/POST | governance workspace and commands | synthetic Hub roles | Human Administer/Contribute decisions by command |
| /api/registry, /api/canonical, /api/canonical-records, /api/schemas | GET/PATCH/POST | canonical registry/read/edit/migration | partial requireActor + technical permissions | Human View/Contribute/Manage/Administer by resource |
| /api/oplocs, /api/operational-areas, /api/operational-configuration | GET/POST | OPLOC and operational config | partial actor guards; local fallback in OPLOC | Human View/Manage/Administer; canonical OPLOC IDs only |
| /api/audit | GET | audit read | inspect current route; target is guarded | Human View, bounded/paginated; AUTHMOD audit visibility scoped |
| /api/hospitality-bookings, /api/bookings/mnk | GET/POST | internal booking workspace / bridge intake | workspace guarded; MNK bridge token | Human Manage for internal; Bridge/Service for intake |
| /api/production, /api/production/materialise, /api/fulfilment-requirements* | GET/POST/PUT | production/fulfilment lifecycle and handoff | Hub roles plus transitional internal token | Human Manage/Approve as applicable; Service for materialisation |
| /api/hospitality-menu*, /api/hospitality-brochures* | GET/POST | menu/brochure governance | mixed Hub-role/bridge guards | Human resource-specific actions; bridge read is Service |
| /api/angel-court/*, /api/upload, /api/connections | GET/POST | inbox scan, uploads, connections | mixed/worker paths | Human Manage/Administer or named Service, based on worker |
| /api/service-definitions, /api/service-arrangements, /api/equipment-types | GET/POST | service catalogue/configuration | Hub technical admin | Human Manage/Administer; no business Publish implication |
| /api/event-staffing, /api/events-read-contract | GET/POST | event-related Hub records | currently guarded in Hub | Out of AUTHMOD app scope for now; do not expand Events Dashboard |

## CPU Production

| Route | Methods | Function | Current | Target |
|---|---|---|---|---|
| /api/production, /api/production-plan | GET/POST | queue, plan, accept/reject/save/plan | Hub-role helper with dev fallback | Human View/Manage scoped to production/site |
| /api/production-plan allergen actions | POST | signatures and matrix artifact | request role is accepted; actor name is derived separately | Explicit production.allergen-sign / production.allergen-final-approve; ignore client role; distinct actors |
| /api/delivered-in/review, /api/menu-publications*, /api/menu-plans* | GET/POST | projections, publication reads/events, plan handoff | mixed/no visible shared guard in route sources | Service for CPU projection; human View/Manage; service events scoped |
| /api/calendar/scan, /api/oplocs, /api/grab-and-go, /api/sandwiches | GET/POST | scan/reference/operational item endpoints | mixed/forwarding | Classify exact consumer; human or service; no public broad write |

## Logistics

| Route | Methods | Function | Current | Target |
|---|---|---|---|---|
| /api/logistics | GET/POST | jobs, assignment, loads, reschedule, loaded, dispatch, collections, drivers, planning, reconciliation/reset/projection | client body.by, default Franco; broad command switch | Human View/Manage per command and OPLOC/date scope; actor from session; maintenance commands separate Administer/named authority |
| /brand-assets/* | GET | brand asset serving | route-specific | Human/session or public only if asset is intentionally public; confirm before guard |

## Menu Planning

| Route family | Methods | Function | Current | Target |
|---|---|---|---|---|
| /api/rolling-menu, /api/rolling-menu/import | GET/POST | weeks, entries, import | rolling menu uses Hub-role helper; import requires inventory | Human View/Contribute/Manage; site scope |
| /api/rolling-menu/publications | GET/POST | publish/withdraw | requirePublicationActor currently equates publish with integration-admin | Human View plus explicit menu.publish; Administer not sufficient |
| /api/menu, /api/menu/import, /api/menu/source-*, /api/menu/recipes | GET/POST | source/catalogue/recipe workflows | several routes lack visible shared auth | Human View/Contribute/Manage; import/source service where proven |
| /api/catalogue, /api/sandwiches | GET/POST | catalogue/sandwich changes | request fields include client updatedBy or no guard | Human Manage; actor from session |
| /api/oplocs | GET | OPLOC reference | authority helper | Human/service View, canonical IDs |

## Hospitality Booking

| Route family | Methods | Function | Current | Target |
|---|---|---|---|---|
| /api/bookings | POST | public customer booking submission | public route | **Public**, retain without employee login; validate abuse/business rules separately |
| /api/reference-data, /api/menus | GET/POST | customer-facing booking/reference and menu flows | mixed | Public only for intentionally public data; internal mutations Human |
| /api/dashboard-bookings, /api/quotes/drive, /api/allergen-matrix* | GET/POST | internal manager dashboard, quote/Drive, matrices | mixed/local session/forwarded cookies | Human View/Manage/Approve by action and OPLOC |
| /api/angel-court/inbox*, /api/brand-assets/* | GET/POST | inbox scanner/proxy/assets | worker or unclassified | Service for scanner/proxy; Human/Administer for manual controls; verify public asset policy |
| /api/local-session | POST | local development session | local scaffold | Dev only; replaced by central session |

## Delivered-In and Grab & Go

| Route family | Methods | Function | Current | Target |
|---|---|---|---|---|
| /api/delivered-in/access | GET | resolve user service/site access | Hub synthetic fixture/prototype | Human app + OPLOC intersection from AUTHMOD |
| /api/delivered-in, /site-menu, /allergens | GET | projections, site menu and allergen views | OPLOC checks in server library | Human View scoped to assigned OPLOC; service calls separate |
| /api/delivered-in/grab-and-go | GET/POST | Grab & Go operational edits/submission | OPLOC check; actor stored from resolved email | Human View/Contribute/Manage; POST denied for View-only |
| /api/delivered-in/grab-and-go/production | GET | CPU handoff/projection | bearer token | Service principal, scoped resource/action |

## Ad-Hoc Production

| Route | Methods | Function | Current | Target |
|---|---|---|---|---|
| /api/requests | GET/POST | request authoring and changes | Hub synthetic role with local fallback | Human View/Contribute/Manage scoped to request/destination |
| /api/oplocs | GET | OPLOC reference | no visible guard | Human/service View as consumer requires |

## Must remain outside normal human login guards

- Hospitality public booking submission (/api/bookings and the public customer pages) unless a route audit proves a sub-route is internal.
- Dedicated service/bridge routes: Hub /api/bookings/mnk, /api/hospitality-menu* bridge contracts, CPU projection/materialisation callbacks, Delivered-In CPU production handoff, and worker/proxy routes. These must receive service-principal/bridge authentication, not a human login requirement.
- Local-only emulator session routes, but only while assertLocalSafety() and explicit non-production boundaries remain intact.

## Current high-confidence gaps

1. Hub synthetic role/email mapping is a business authorization boundary; it must migrate to immutable AuthIdentity/grants.
2. Hub local session cookie is deliberately one year and secure false; it is not a production session design.
3. Logistics accepts client actor attribution and a named default.
4. CPU allergen signing accepts a request-selected role and needs explicit signatory grants plus distinct-actor enforcement.
5. Menu Planning publication currently requires technical integration-admin, collapsing Administer and Publish.
6. Menu Planning sandwiches/menu/source routes include untrusted actor fields or lack visible guards.
7. Delivered-In site checks are valuable but currently depend on synthetic access resolution.
8. Transitional internal tokens can represent a broad shared capability and need named, scoped service principals.

## Inventory limits

This is a Phase A source inventory of all in-scope API route files and route families, not a claim that every handler's nested command branch has been semantically proven. Before Phase E, expand each family into one row per command/action, record exact current tests and callers, and confirm public/service integrations with runtime traces.
