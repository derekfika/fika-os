# Selective staging to production data migration: plan and dry run (2026-10-14)

Status: **DRY RUN ONLY. Nothing was written to production.** Source: Firestore project `fika-os-dev` (staging). Target: `fika-os` (production).

## Production state found (read-only)
- Production Firestore is **not enabled** in `fika-os` (no database exists), so there are no production collections and no collision risk. Creating the database is a production change and needs approval.
- Production App Hosting backends exist (`fika-os-prod-hub|hospitality|cpu|menu|logistics|deliveredin`) with custom domains, but **no successful rollout exists** (CPU: 3 failed); every production domain currently returns HTTP 404.

## Dry-run totals (root collections: 63, documents 9697)
- MIGRATE: **1868** (954 root documents + 105 Menu Planning week days + 809 day entries)
- REVIEW: **1141** root documents (plus the days/entries of 7 REVIEW weeks, not migrated)
- DO NOT MIGRATE: **7602**
- Documents to create: 1868; identical: 0; conflicts: 0 (production is empty)
- Writes to transactional/derived/outbox collections: **0**

## Collection matrix
| Collection | Domain | Source docs | MIGRATE | REVIEW | DO NOT | Main reason |
|---|---|---:|---:|---:|---:|---|
| `authmodAccessAudit` | AUTHMOD/Hub | 165 | 0 | 0 | 165 | DO_NOT_MIGRATE: staging access audit evidence |
| `authmodAccessHeads` | AUTHMOD/Hub | 3 | 0 | 3 | 0 | REVIEW: AUTHMOD access data is bound to STAGING Firebase Auth UIDs; production access must be established deliberately (fail-closed) |
| `authmodAppAssignments` | AUTHMOD/Hub | 17 | 0 | 17 | 0 | REVIEW: AUTHMOD access data is bound to STAGING Firebase Auth UIDs; production access must be established deliberately (fail-closed) |
| `authmodApplications` | AUTHMOD/Hub | 7 | 7 | 0 | 0 | MIGRATE: application registry (no user identity data) |
| `authmodAuthorityGrants` | AUTHMOD/Hub | 53 | 0 | 53 | 0 | REVIEW: AUTHMOD access data is bound to STAGING Firebase Auth UIDs; production access must be established deliberately (fail-closed) |
| `authmodCustodianAssignments` | AUTHMOD/Hub | 10 | 0 | 10 | 0 | REVIEW: AUTHMOD access data is bound to STAGING Firebase Auth UIDs; production access must be established deliberately (fail-closed) |
| `authmodIdentities` | AUTHMOD/Hub | 19 | 0 | 19 | 0 | REVIEW: AUTHMOD access data is bound to STAGING Firebase Auth UIDs; production access must be established deliberately (fail-closed) |
| `authmodImportResolutions` | AUTHMOD/Hub | 39 | 0 | 0 | 39 | DO_NOT_MIGRATE: staging import workflow state |
| `authmodImports` | AUTHMOD/Hub | 1 | 0 | 0 | 1 | DO_NOT_MIGRATE: staging import workflow state |
| `authmodSiteAssignments` | AUTHMOD/Hub | 51 | 0 | 51 | 0 | REVIEW: AUTHMOD access data is bound to STAGING Firebase Auth UIDs; production access must be established deliberately (fail-closed) |
| `fikaBookingAudit` | Hospitality | 131 | 0 | 0 | 131 | DO_NOT_MIGRATE: audit of excluded UAT Bookings |
| `fikaBookingNotifications` | Hospitality | 36 | 0 | 0 | 36 | DO_NOT_MIGRATE: notification obligations of excluded Bookings |
| `fikaBookings` | Hospitality | 25 | 0 | 0 | 25 | DO_NOT_MIGRATE: UAT/test Hospitality Bookings |
| `fikaCpuAllergenCompositionAuthoritiesV1` | CPU Production | 2 | 0 | 0 | 2 | DO_NOT_MIGRATE: UAT reuse authority |
| `fikaCpuMasterAllergenReviewsV1` | CPU Production | 10 | 0 | 0 | 10 | DO_NOT_MIGRATE: UAT allergen review state |
| `fikaCpuProductionChangeCursorV1` | CPU Production | 1 | 0 | 0 | 1 | DO_NOT_MIGRATE: derived cursor |
| `fikaCpuProductionChangeReceiptsV1` | CPU Production | 641 | 0 | 0 | 641 | DO_NOT_MIGRATE: UAT change receipts |
| `fikaCpuProductionChangesV1` | CPU Production | 939 | 0 | 0 | 939 | DO_NOT_MIGRATE: UAT change stack |
| `fikaCpuProductionDayProjectionsV1` | CPU Production | 61 | 0 | 0 | 61 | DO_NOT_MIGRATE: derived projection (production regenerates) |
| `fikaCpuProductionItemsV1` | CPU Production | 230 | 227 | 0 | 3 | MIGRATE: saved sandwich/production item library (allergen checker) |
| `fikaCpuProductionPlansV1` | CPU Production | 54 | 0 | 0 | 54 | DO_NOT_MIGRATE: UAT CPU production plans |
| `fikaCpuProjectionOutboxV1` | CPU Production | 53 | 0 | 0 | 53 | DO_NOT_MIGRATE: outbox |
| `fikaCpuProjectionPackageHeadsV1` | CPU Production | 146 | 0 | 0 | 146 | DO_NOT_MIGRATE: derived package heads |
| `fikaCpuProjectionReconciliationV1` | CPU Production | 8 | 0 | 0 | 8 | DO_NOT_MIGRATE: derived reconciliation state |
| `fikaCpuPropagationOutboxV1` | CPU Production | 1158 | 0 | 0 | 1158 | DO_NOT_MIGRATE: outbox/dead-letter |
| `fikaDeliveredInAllergenSafetyV1` | Delivered-In / Grab & Go | 26 | 0 | 0 | 26 | DO_NOT_MIGRATE: published Delivered-In safety state |
| `fikaDeliveredInCpuReleaseHeadsV1` | Delivered-In / Grab & Go | 26 | 0 | 0 | 26 | DO_NOT_MIGRATE: UAT release heads |
| `fikaDeliveredInCpuReleaseReceiptsV1` | Delivered-In / Grab & Go | 54 | 0 | 0 | 54 | DO_NOT_MIGRATE: UAT release receipts |
| `fikaDeliveredInGrabAndGoHandoffV1` | Delivered-In / Grab & Go | 3 | 0 | 0 | 3 | DO_NOT_MIGRATE: Grab & Go test handoff |
| `fikaDeliveredInGrabAndGoOrdersV1` | Delivered-In / Grab & Go | 5 | 0 | 0 | 5 | DO_NOT_MIGRATE: Grab & Go test orders |
| `fikaDeliveredInProjectionHeadsV1` | Delivered-In / Grab & Go | 111 | 0 | 0 | 111 | DO_NOT_MIGRATE: derived projection |
| `fikaDeliveredInProjectionIndexHeadsV1` | Delivered-In / Grab & Go | 30 | 0 | 0 | 30 | DO_NOT_MIGRATE: derived projection |
| `fikaDeliveredInSiteMenusV1` | Delivered-In / Grab & Go | 2 | 0 | 0 | 2 | DO_NOT_MIGRATE: generated site menus pointing at staging Drive files |
| `fikaDomainEventInboxV1` | Shared fulfilment/events | 403 | 0 | 0 | 403 | DO_NOT_MIGRATE: event inbox |
| `fikaDomainEventsV1` | Shared fulfilment/events | 486 | 0 | 0 | 486 | DO_NOT_MIGRATE: UAT domain events |
| `fikaFulfilmentRequirementsV1` | Shared fulfilment/events | 99 | 0 | 0 | 99 | DO_NOT_MIGRATE: UAT fulfilment requirements |
| `fikaLogisticsAssignmentsV1` | Logistics | 13 | 0 | 0 | 13 | DO_NOT_MIGRATE: UAT logistics assignments |
| `fikaLogisticsChangeCursorV1` | Logistics | 36 | 0 | 0 | 36 | DO_NOT_MIGRATE: derived cursor |
| `fikaLogisticsChangesV1` | Logistics | 861 | 0 | 0 | 861 | DO_NOT_MIGRATE: UAT change stack |
| `fikaLogisticsCollectionPreferencesV1` | Logistics | 1 | 0 | 0 | 1 | DO_NOT_MIGRATE: UAT preference tied to a staging job |
| `fikaLogisticsDayProjectionsV1` | Logistics | 35 | 0 | 0 | 35 | DO_NOT_MIGRATE: derived projection |
| `fikaLogisticsDeliveryLoadsV1` | Logistics | 22 | 0 | 0 | 22 | DO_NOT_MIGRATE: UAT loads |
| `fikaLogisticsDeliveryRunsV1` | Logistics | 38 | 0 | 0 | 38 | DO_NOT_MIGRATE: UAT runs |
| `fikaLogisticsDeliveryStopsV1` | Logistics | 3 | 0 | 0 | 3 | DO_NOT_MIGRATE: UAT stops |
| `fikaLogisticsJobsV1` | Logistics | 81 | 0 | 0 | 81 | DO_NOT_MIGRATE: UAT jobs |
| `fikaLogisticsMovementRequestsV1` | Logistics | 3 | 0 | 0 | 3 | DO_NOT_MIGRATE: UAT movements |
| `fikaLogisticsProjectionOutboxV1` | Logistics | 214 | 0 | 0 | 214 | DO_NOT_MIGRATE: outbox |
| `fikaMenuPlanningArchiveMetadata` | Menu Planning | 6 | 0 | 0 | 6 | DO_NOT_MIGRATE: points at staging test Drive files |
| `fikaMenuPlanningCatalogue` | Menu Planning | 404 | 401 | 0 | 3 | MIGRATE: saved dish / recipe catalogue record (stable ID preserved) |
| `fikaMenuPlanningCatalogueCleanup` | Menu Planning | 1 | 0 | 0 | 1 | DO_NOT_MIGRATE: staging operation log |
| `fikaMenuPlanningCatalogueManifests` | Menu Planning | 1 | 0 | 0 | 1 | DO_NOT_MIGRATE: derived manifest (regenerated from the catalogue) |
| `fikaMenuPlanningEvents` | Menu Planning | 436 | 0 | 0 | 436 | DO_NOT_MIGRATE: UAT publication events |
| `fikaMenuPlanningOutbox` | Menu Planning | 437 | 0 | 0 | 437 | DO_NOT_MIGRATE: UAT outbox |
| `fikaMenuPlanningPublications` | Menu Planning | 7 | 0 | 0 | 7 | DO_NOT_MIGRATE: UAT Delivered-In publications |
| `fikaMenuPlanningPublishedSnapshots` | Menu Planning | 20 | 0 | 0 | 20 | DO_NOT_MIGRATE: UAT published snapshots |
| `fikaMenuPlanningWeeks` | Menu Planning | 22 | 15 | 7 | 0 | MIGRATE: historical imported Meal Planner week (no publication state) |
| `fikaProductionOrdersV1` | Shared fulfilment/events | 109 | 0 | 0 | 109 | DO_NOT_MIGRATE: UAT Production Orders |
| `fikaProductionRequirements` | Shared fulfilment/events | 18 | 0 | 0 | 18 | DO_NOT_MIGRATE: UAT production requirements |
| `integrationHubCacheManifests` | Hub | 1 | 0 | 0 | 1 | DO_NOT_MIGRATE: derived cache manifest |
| `integrationHubCanonical` | Hub | 893 | 161 | 560 | 172 | REVIEW: BrightHR-derived personal/HR record in needs-review; not required by the launch apps; privacy review first |
| `integrationHubCanonicalRevisions` | Hub | 254 | 38 | 35 | 181 | DO_NOT_MIGRATE: revision of an excluded/dev canonical record |
| `integrationHubGovernanceAudit` | Hub | 635 | 66 | 386 | 183 | REVIEW: follows its REVIEW record |
| `integrationHubSourceMappings` | Hub | 41 | 39 | 0 | 2 | MIGRATE: governed source/provider-location mapping |

Regenerate with: `node tools/migration/staging-to-production-dry-run.mjs --out report.json` (read-only; refuses `--execute`). The per-document create list is in `production-migration-dry-run-report.json`.
