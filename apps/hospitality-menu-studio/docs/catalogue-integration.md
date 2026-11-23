# Hospitality Catalogue in Menu Studio

Owner direction is recorded in [#666](https://github.com/derekfika/fika-os/issues/666). The #660 baseline is main `fe521f6bc0f4b740da4a2149b9bb625d5d784d8b`, with PRs #661–#665 in its ancestry. The Studio staging build identity observed on 23 November 2026 was `7d6f831e7866be5db6a9212a8770fde947841836`. Check build identity again before hosted acceptance.

## Commercial authority

Studio hosts the management screens. Hub retains the Item, Offering, Price, routing, service layout, merge, booking and audit authorities. Studio sends the caller's existing session cookie to one fixed Hub endpoint. A commercial write needs an exact Studio browser origin, current Studio Manage admission and Hub's current `hospitality.catalogue.manage` permission. Hub evaluates the latter on every POST. Studio derives show/hide controls from both authorities and makes no grants. The Hub screen uses the same command route and retains its same-origin access.

The admin GET is a single bounded Hub catalogue snapshot when an operator opens or refreshes the view. Mutations use the returned row or stored-layout receipts. Hub returns the package refresh state separately. A response loss means the command outcome is unknown and requires checking the catalogue. The gateway never retries a write and forwards the original idempotency keys and versions. It retains no canonical records.

An explicit site, service and event-date check reads the authenticated, integrity-verified Hub public package. It applies the existing price and service-category resolvers and reports standard eligibility, quote-only availability or unavailability. Its scope is the published catalogue and site-level rules for that selection. Booking acceptance runs the full authorised basket, site, timing and operational-area checks independently. An unreadable or unverified package produces an unavailable check.

## Hub parity inventory

The source of truth for this inventory is `apps/integration-hub/app/api/hospitality-catalogue/route.ts`, its loader and command service, and the current Hub catalogue components. Some historic docs describe superseded Offering commands. The current endpoint uses the sparse Item/site commands below.

| Hub operation | Authoritative action or data | Studio work package and required evidence |
| --- | --- | --- |
| Product browse and management overview | Admin GET, active/archived, price and routing flags, canonical IDs and per-site summary | Read views, filters and catalogue freshness |
| Product creation and paste/import | `create-item`, `bulk-create`, request IDs and operation ID, selected sites or allowlist, routing and explicit categories | Product editor and bulk creation, same canonical IDs on replay |
| Product name, category, descriptions, minimum, company price and VAT | `update-item` and `set-default-price`, Item version, Hub London effective date | Product editor, inherited price and effective date checks |
| Quote-only, selling unit, production conversion, guest/notice and configuration | Existing Item creation and site override command fields, admin reads of current defaults and stored exceptions | Product and site editors, verified quote mode and constraints |
| Routing | `set-routing`, independently versioned, unresolved/conflict state and exact-source hint | Product editor, explicit routing selection |
| Archive and restore | `set-item-status`, Item version, retain records and history | Product editor, protected archive and restore |
| Individual and selected-set site availability | `set-site-availability` and `bulk-update` PID scope | Site editor and bulk operations, effective enable/disable with retained overrides |
| Site price/VAT, quantity and guest minima, notice, local wording, configuration and mode | `set-site-override`, Item version, `null` restores inheritance for supported fields | Site editor, active site-wide exception distinguished from area detail |
| Company and site service layout | `set-service-categories`, `clear-service-override` with document version, exact category identity and reason | Service editor, hide/show, select and order, explicit override/reset |
| Category rename and governance | `rename-category`, full expected Item and layout versions, reason and operation ID | Service/category editor, archived Items and stored scope checks |
| Bulk routing, default price, minimum, category, sites and archive | `bulk-update`, up to 50 explicitly selected IDs, Item/routing versions, visibility confirmation, per-row receipts | Bulk editor, preview impact, definite and unknown outcomes |
| Provider/source references and canonicalisation warnings | Admin Item/source references, read model counts and flags, `link-provider-item` | Governance surface, explicit provider identity and version |
| Default adoption from historical site prices | `adopt-company-default`, Item version and explicit confirmation, preserve differing site overrides | Governance surface, show suggested and operator-required findings |
| Duplicate comparisons, merge, keep separate and defer | `merge-items`, `record-review-decision`, canonical versions, exact group membership | Governance surface, explicit survivor and documented rejection paths |
| Refresh and operational evidence | Hub targeted response, package publication status, atomic audit/revisions, existing booking snapshots | Show save receipt and package state separately, compare synthetic historical snapshots |
| Legacy canonicalisation and catalogue migration planners | Existing runbooks/CLI, not ordinary Hub screen commands | Outside screen relocation. Existing approval and audit apply to independent migration tasks |

## Hosted acceptance checklist

1. Pin the requested merge and run the governed `fika deploy menu-studio --staging --sha <merge>` dry run. Hub must serve a compatible catalogue command/read provider. Obtain separate authority before either rollout.
2. Open Studio on its custom staging domain and verify the build identity and the Hub sign-in return. Verify Studio read-only, Studio-only editor, and authorised catalogue manager as separate identities.
3. Verify read-only product, inherited company price and sparse site exception views on laptop, tablet and narrow screens. Check keyboard focus, emulated and actual touch separately, and an explicit service and event-date check.
4. Use authorised isolated fictional records for writes. Check a quote-only item, site enable/disable and override reset, archived items, conflict handling, category rename, CSV and bulk retries, and duplicates. Compare commands and results with Hub. Treat a stale package or unknown command outcome separately from a confirmed save.
5. Compare an existing fictional quote/booking snapshot before and after a commercial edit. Verify only the expected current availability changes and that a mapped Studio Section still resolves to its canonical Item without losing its draft or rotation.
6. Keep the Hub UI operational until feature parity, hosted UAT and explicit owner cutover approval. No deployment, operational notification or live booking is authorised by this checklist.
