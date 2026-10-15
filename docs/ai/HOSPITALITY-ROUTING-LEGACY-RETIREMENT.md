# Hospitality production routing: governed model and legacy-map retirement plan

## Model (standard for every Hospitality platform)

- Each canonical Hospitality Menu Item has its OWN governed routing record in `integrationHubHospitalityMenuProductionRouting`
  (document id = `stableDocumentId(canonicalId)`, field `workstreams[]`). Identity includes the platform:
  `hospitality-menu-item:<platform>:<stable platform-specific key>` (platforms: `mnk`, `angel-court`, `cfc`, `munich-re`, `rcoa`, future).
- Same-named items on two platforms may share a Hub row (presentation only) but never share or propagate routing.
- States: no record = Unclassified / Routing required; record with no flags = In house; Sandwiches; Hospitality; Delivered-In only = no
  Hospitality CPU line; Sandwiches + Hospitality = Routing conflict (fail closed).
- Hand-off (`createProductionFromApprovedBooking`): for a GOVERNED platform every line is resolved to its canonical item and record; any
  Routing required / Routing conflict blocks the whole hand-off (no partial order); otherwise only Sandwiches/Hospitality lines go to CPU and the
  booking keeps every line; zero CPU lines = no Production Order (`no_cpu_production_required`).
- Dashboards show the same line/booking states for every platform (`cpuRouting` on the workspace feed). For platforms that are not governed yet
  the state is advisory (`enforced: false`, legacy fallback used for display only).

## Which platforms are governed

`HOSPITALITY_GOVERNED_ROUTING_PLATFORMS` (comma list, default `rcoa`). A platform is added only when
`scripts/hospitality-routing-readiness.ts` reports `readyToGovern: true` (every brochure item promoted and classified, no conflicts).

## Promotion

`scripts/promote-hospitality-menu-items.ts --platform <rcoa|angel-court|cfc|munich-re> --project <non-production> [--apply]`: dry run by default,
create-only, idempotent, audited, creates no routing records and NO providerMappings (a mapping would switch the booking price validator to the
canonical record, which holds no price). `scripts/promote-local-portal-menu-items.ts` (emulator only, writes mappings) must not be used on staging/production.

## Legacy hard-coded map (`LEGACY_HOSPITALITY_MENU_ROUTING` in `connections-service.ts`)

11 transitional entries. Usage per platform catalogue: MNK 8 keys, RCoA 8 (already copied into governed records on staging and no longer
consulted), Angel Court 3 (`deli-style-sandwich`, `exotic-fruit-box`, `mini-traybake-bites`), CFC 1 and Munich Re 1 (`exotic-fruit-box`).
It still labels the workstream for non-governed platforms' hand-offs and feeds the advisory dashboard state. It is no longer authoritative for RCoA.

### Safe retirement plan
1. Promote Angel Court, CFC and Munich Re (dry run, review, apply per environment) and confirm MNK's 3 un-promoted items.
2. In Hub, classify every item of one platform at a time (the 13 legacy decisions are the only pre-existing hints; they are NOT copied automatically
   between platforms, names are not identity).
3. Run the readiness report; when a platform is `readyToGovern`, add it to `HOSPITALITY_GOVERNED_ROUTING_PLATFORMS` for that environment (staging first,
   UAT the mixed / all-In-house / missing / conflict cases) and watch for Routing required hand-off errors.
4. When all platforms are governed: delete the map, the `hospitalityMenuProductionRouting` legacy merge and the `hospitality-menu-item:mnk:` alias loop,
   drop the `legacy` argument from the planner, and make governed routing unconditional (remove the platform list).
5. Production follows the same order only with an approved dry run and an approved candidate SHA.
