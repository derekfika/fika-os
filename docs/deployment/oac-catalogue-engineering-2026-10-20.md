# OAC catalogue engineering preparation — 20 October 2026

Status: local supporting code and review plan only. **No approval to mutate or publish production.** Starting origin/main and current HEAD: `755a7f8748336f8db1961ea64044900bf1ad9a17`. Existing uncommitted booking-migration work is preserved, not included in this task's approval.

## Engineering implementation

- The existing canonical Item accepts optional `allowedOplocIds`. New OAC-only `create-item` requests use `restrictToSelectedOplocs:true, oplocIds:[OAC]`. Item scope, default Price, routing, revisions and audit commit atomically. Restricted creations do not fan out exclusion Offerings; the Item-level allowlist excludes every other site, including future sites. The allowlist also blocks OPLOCs activated later; absence preserves the ordinary company-wide model. No positive Item×OPLOC matrix. Ordinary availability commands cannot broaden a restricted Item.
- The existing `set-site-override` command now supports strict configuration, independent guest minima, notice days and offering mode. Configuration is a complete replacement of the **site exception's** configuration, not an edit to company defaults. `null` clears the site configuration; omitted fields are unchanged. The normal effective resolver layers Item defaults with this sparse exception. Quote-only mode cannot be assigned a purchase price. A new exception inherits the Item mode.
- Configuration `rules` supports indicative starting price, exact elapsed notice hours, canonical parent-package dependency/quantity policy, explicit sales unit and production conversion, and whether a guest minimum is genuinely event- or product-derived. Choice groups can allocate numeric quantities to stable variety IDs, with an explicit minimum for each selected variety and allocation total equal to ordered quantity. Duplicate/unknown IDs, invalid quantities and incomplete totals fail closed.
- Browser and Hub booking authority use the same pure rule validator. The actual Hub ingestion path is tested, not only helpers. OAC unmapped legacy/local menu IDs now fail with an instruction to refresh/map canonically: old local prices cannot bypass the governed catalogue. Other sites' compatibility paths are preserved. Approved historical migration mappings are a separate concern.
- Gallagher company/domain identification, five-guest floor and mandatory Invoice/PO reference remain. Product quantity minima cap at five; smaller minima remain. **Only an explicit `guestMinimumKind:product` policy** caps a product-derived guest floor. Event guest floors remain untouched. The proposed OAC Deli override uses this policy, price10.95 and minimum quantity10. Ordinary customers need10; Gallagher can buy5. Named-variety/pack constraints are not automatically waived.
- Production conversion is calculated from server-owned catalogue metadata captured into the new booking snapshot, not supplied by the browser or inferred from labels. Existing booking replay returns its existing commercial/unit snapshot. Historical records are not backfilled/repriced.
- OAC quote-only cards show an indicative starting price and instruct the customer to contact the site team. They have no order controls; submission rejects a starting price as a purchase price. The existing non-OAC menu conversion keeps quote-only Items out of priced baskets. This does not introduce an automatic quotation/email workflow.
- Package contract/schema advances to v2; new client cache namespace is v3. Updated clients can read existing v1 packages during deployment. V1 cannot carry site restrictions; older clients reject v2 rather than silently exposing restricted products. Publish only after coordinated code deployment and verify both private/public heads and byte hashes. No package was published here.
- Create request IDs are bound to the canonical request-body hash. Exact replay is a no-op, but changed/unverifiable body reuse is rejected. File-only sync planning hashes source identity and exact actions, rejects shared-default/other-site actions, and holds unresolved decisions. There is deliberately no apply runner or worker import.

## Brochure representational decisions

| Concern | Technical treatment | Remaining approval |
|---|---|---|
| Croissants | Preserve live £60/box-of12 Item and history. Prefer a separately reviewed each-unit SKU at£5/min12 with explicit1each→1croissant conversion. Do not change the existing box SKU's price to£5. | Distinct SKU/pack identity, flavour allocation and routing. |
| Finger Food | One quantity-allocation group; each selected variety≥12; total equals ordered pieces. £3.95/piece. | Exact15 stable varieties; applicability of slide's20-guests/10-days header; confirm any Gallagher exception to variety minimum explicitly. |
| Nibble bowls | Per-variety allocation≥3; £2/bowl; serving guidance3people/bowl. | Stable variety IDs/configuration and routing; no automatic inference from similar snacks. |
| Cakes | Quote-only; indicative from£27/£20, serves12/10; exact72hours notice where configured. No fixed standard Price. | Celebration identity/routing. A quoted price is agreed through the existing governed quote workflow, not a starting-price checkout. |
| House Drinks | Canonical parent package; add-ons require that parent in the same service basket, with approved quantity policy. | Base package identity, same vs at-most quantity policy, exact duration/inclusions and routing. Never enable free-standing uplift products. |
| Yoghurt | Existing Breakfast Pots is broader and not automatically equivalent. | Restrict an OAC variant or create a distinct reviewed product; no name-only merge. |
| Juice | Existing250ml canonical Item already£3;1litre is a distinct pack. | Volume, one-product-with-choices vs separate products, extra seasonal/Mixed options. |
| Rolls/Salads | OAC sparse config can preserve other sites' choices and prices. | Per-platter allocation, sauces/guest-serving guidance and whether extra live options should remain. |
| Wines/pitchers/new products | Can be permanently site-limited with explicit selling/production units. | All new routing choices; wine size/vintage availability where not stated. |

Available routing choices are `in_house`, `cpu_sandwiches`, `cpu_hospitality`, `cpu_delivered_in`. Empty/unresolved is **not** in-house. Existing verified routing and allergen evidence are retained. No ingredients, names or brochure dietary markers become allergen authority.

## Review artifacts and exact scope

Authoritative live evidence and all53 before/after rows are outside Git:
`C:\Users\derek\Documents\FIKA OS Migration Evidence\OAC-Catalogue-2026-10-20\engineering-plan-final`

- `item-level-53.csv` / `.json`: identities, current/proposed commercial constraints, units, choices, routing, scope and disposition.
- `routing-review.csv`: affected existing Items and proposed creations, available choices and unresolved approvals.
- `plan-NOT-APPROVED.json`: six locally ready update proposals,41 held decision rows, six commercially correct rows and Classic exclusion. The41 include26 creations awaiting routing plus15 business/configuration holds; they are not41 engineering failures.
- `plan-review.md`: compact review table. The ready subset is water, canned drinks, Deli, loaf cake, canapes and bowl food. They are **not authorised live mutations**.

Plan hash: `52dc52c5af8e50583620f1d21725e8409cff1da814edc0529ebc7de78c5df639`.
Source-state hash: `a44bdcb7aa3b8c89c1fa877734e4ac462a81806d2ed0dca0db199255098fff91`.
Evidence was read20October2026; source must be refreshed and re-approved before execution. Changing a decision, action, mapping or source identity requires a new plan hash.

Classic Working Lunch remains excluded from creation; no existing historical reference is deleted. `deli_working_lunch`→`hospitality-menu-item:mnk:deli_sandwich_lunch` is supported by54 original records; migration must retain original quantities, prices, minimums, dietaries and provenance. No booking migration ran here.

Management fee remains8%, with its existing base/ordering. Existing VAT configuration is unchanged. New-product VAT/routing are not inferred from brochure names.

## Safe sequence after review (not executed)

1. Review/isolate this code from existing uncommitted migration work; approve commit/push separately. No blanket staging.
2. Resolve remaining business/routing decisions and generate the final complete plan against freshly read canonical source/versions. Review the new hash and rollback inventory.
3. Validate coordinated Hub/Hospitality code on staging, especially numeric variety inputs, quote enquiry cards, warm cache transition, each/box CPU conversion and unchanged RCoA. No customer emails or handoffs during catalogue checks.
4. Deploy reviewed Hub/Hospitality code before publishing v2. New clients accept the existing v1 data; no forced early head switch. Old clients must refresh once v2 becomes current.
5. Apply approved version-checked site mutations/atomic restricted creations only. Current API mutations trigger republishing: order commands so dependencies exist and every intermediate product is valid; do not publish a half-configured product. A `stale` publication result requires recovery, not a success report. Recheck both private/public manifests, raw compressed hashes and effective catalogues at all other OPLOCs.
6. Revalidate browser manifest/hash and current IndexedDB content, Gallagher/ordinary constraints and explicit routing before approving migration. Customer booking activation is separate.
7. Rollback with fresh-version compensating OAC overrides or archive newly created Items; retain all old Item/Price/revision/audit/booking evidence. Republish packages from reverted authority rather than pointing a head at stale data.

No broad architecture redesign, production mutation, deployment, email, booking, CPU handoff, Logistics job, scheduler change or legacy migration is authorised/performed. **CONDITIONAL GO for engineering review; NO-GO for full production catalogue synchronisation until the held decisions and staging/UAT gates close.**

## Validation results

- Final Hub focused rules/contracts/cache/RCoA/migration regression batch:60/60PASS. Includes actual Hub ingestion for per-variety allocation, Gallagher company/domain behaviour, retained event floors, old-booking replay and rejection of unmapped OAC fixture IDs.
- Catalogue emulator regression batch:11/11PASS (9existing+2new); final2new persistence cases rerun successfully after the scope fan-out correction. Tests verify zero operational-record changes relative to before-state, not merely helper return values.
- Additional Hub package/default/production/group/routing batch:73PASS,1optional group-quote Firestore case SKIPPED. No failure is waived.
- Full affected Hospitality application suite:255/255PASS.
- Hub,Hospitality,CPU typechecks:PASS. CPU's stale installed local package export was refreshed in ignored node_modules; the two CPU job-detail views now display allocation quantities with server-owned labels.
- Hub,Hospitality and CPU production builds:PASS. Generated quote assets/next-env changes were restored; no generated build noise is included.
- git diff --check:PASS. Existing migration additions preserved. No commit/push/deployment/publication, no production/staging data write, no customer artifacts/emails/CPU handoffs/Logistics jobs/scheduler operations. The owned test emulator was local-only; it is stopped at handoff.
- Style Guide compliance:PASS by source inspection; focused manual browser/keyboard UAT remains required before production release. No live browser UAT is claimed.

Post-display integration check:16/16 rules/ingestion/quantity-label tests and14 group-quote regressions PASS (1optional Firestore case SKIPPED). Numeric variety allocations are rendered in canonical quotes and both CPU job-detail views; no allergen states, signatures or lifecycle logic changed. Manual operator UAT remains a release gate.
