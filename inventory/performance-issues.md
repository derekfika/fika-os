# Performance Issue Inventory

## CPU Production Dashboard observations

| Area | Confirmed code pattern | Risk | Measurement TODO |
|---|---|---|---|
| Calendar scans | Rebuilds the complete Orders source map for scans/chunks and may read JSON file metadata | Repeated Sheet/Drive latency | Events/pages, unchanged ratio, calls and scan duration |
| Order upsert | Reads all existing rows; updates existing orders individually; batches additions | Scaling/timeout and partial-write risk | Rows, changed records, calls and failures |
| Delivery upsert | Reads all delivery rows and updates individually without the Orders script lock | Scaling/concurrency risk | Volume and overlapping runs |
| Attachment parsing | Reads/converts several document formats and applies extensive heuristics | Quota, timeout and partial processing | Per-format duration/conversions/errors |
| Detail/photo actions | Reads all orders across the full range before key lookup | Avoidable history-sized work | Rows and action latency |
| Browser production view | Re-categorises and aggregates visible items on render/filter changes | Client cost and name-based correctness risk | Payload, item count and render time |
| Cache | Any order/delivery mutation increments one global version | Broad invalidation | Hit rate and payload size |

Large CPU files: `02_AttachmentParser.js` about 41 KB, `Script.html` about 93 KB and `Styles.html` about 40 KB. Size is a maintainability signal, not evidence of measured slowness.

## Status

Code patterns are confirmed; runtime impact remains suspected until measured. No production timing or dataset-size data was available.

| App ID | Screen or function | Symptom | Approximate delay | Suspected cause | Calls made | Dataset size | Frequency | Business impact | Quick fix | Notes |
|---|---|---|---|---|---|---|---|---|---|---|
| All five Hospitality Dashboards | Initial dashboard load / `getDashboardBookings` | Suspected slower load as history grows | TODO | Full `Dashboard Data` range is read and normalised for the browser | One full Sheet range read plus client transfer per load | TODO | Every dashboard load | TODO | Maybe | Confirmed code pattern; symptom and impact unmeasured. |
| All five Hospitality Dashboards | Settings access | Suspected repeated service latency | TODO | Settings helpers read the full Settings sheet across operational calls | Multiple full settings-range reads depending on action | TODO | Load, settings, and workflow actions | TODO | Maybe | The Line contains cache-related code not present in the other configs; behaviour needs verification. |
| All five Hospitality Dashboards | Gmail scan/import | Suspected long scans or timeouts on large inboxes | TODO | Searches can cover hundreds of threads, then iterate messages/attachments and convert XLSX files | Gmail search, message/attachment loops, Drive conversion, parser and Sheet writes | TODO | Manual and/or scheduled scan | TODO | Maybe | Confirmed workload pattern; query selectivity and real scan volume TODO. |
| Angel Court, CFC, MNK, Demo dashboards | Shared booking-form parser | Suspected avoidable Sheet service work | TODO | Parser requests full values and display values multiple times for the converted workbook | Multiple `getDataRange()` reads per parse path | TODO | Per imported/rescanned form | TODO | Maybe | Parser file is exact in CFC/MNK/Demo and near-identical in Angel Court. |
| The Line Hospitality Dashboard | The Line parser and revision scan | Suspected slower import/rescan for complex forms or large history | TODO | Several full workbook passes plus Gmail search, fingerprinting, and dashboard scan-index construction | Full values/display reads, nested loops, Sheet index reads, Gmail/attachment processing | TODO | Per scan/rescan | TODO | Maybe | Extra work supports genuine revision/deduplication behaviour and should not be removed without tests. |
| All five Hospitality Dashboards | Quote folder resolution | Suspected Drive latency and ambiguity | TODO | Quote workflow searches root and child folders by name | Repeated `getFoldersByName` calls per relevant quote action | TODO folders | Per quote generation | TODO | Maybe | Stored folder IDs may be preferable, but current production folder ownership is unknown. |
| Angel Court, CFC, MNK, Demo dashboards | Feedback metrics | Suspected slower metrics as feedback grows | TODO | Exact shared module reads the full feedback sheet | One full Sheet range read per metrics request | TODO | When metrics load/refresh | TODO | Maybe | The Line does not contain the feedback module. |
| MNK Hospitality Dashboard | Bulk quote regeneration/audit tools | Suspected timeout/quota risk | TODO | Loops through dashboard rows with repeated cell reads and quote/Drive work | Row-by-row Sheet reads plus document/Drive actions | TODO | Administrative/bulk operations only | TODO | No | Batch strategy requires workflow and idempotency design; not a trivial change. |
| MNK Hospitality Dashboard | Recharge synchronisation | Suspected slow sync and partial-write risk | TODO | Reads booking rows individually and writes recharge cells separately | Per-row source reads; three separate destination cell writes per inserted row; formula scanning | TODO | On recharge sync | TODO | Maybe | Duplicate prevention and retry behaviour require business confirmation. |
| All five Hospitality Dashboards | Browser/server interaction | Suspected visible latency across sequential actions | TODO | Each client contains roughly 15–17 `google.script.run` call sites | Separate remote calls for load, settings, scan, update, quote, Calendar, confirmation, cancellation, etc. | N/A | Per user workflow | TODO | Maybe | Call count alone is not proof of a problem; measure representative workflows before changing boundaries. |
| MNK, Angel Court, CFC, Demo Booking Platforms | Submission concurrency | Suspected queueing under simultaneous submissions | TODO | A script-wide lock serialises booking creation and waits up to the configured lock period | One lock acquisition around build, validate, multi-Sheet write and notification | TODO concurrent users | Per submission | TODO | Maybe | Lock prevents local races but broadens the critical section. Measure before narrowing it. |
| MNK, Angel Court, CFC, Demo Booking Platforms | Duplicate booking-ID check | Suspected linear slowdown as dashboard history grows | TODO | Reads the complete dashboard BookingID column and scans it before append | One column-range read per submission | TODO dashboard rows | Per submission | TODO | Yes | Confirmed pattern; replace only as part of an approved idempotency/index design. |
| MNK, Angel Court, CFC, Demo Booking Platforms | Multi-Sheet persistence | Suspected partial-state/recovery risk rather than measured latency | TODO | Dashboard row is appended before line-item/request-log writes; rollback deletes rows on caught failure | Multiple Sheet writes and compensating deletes | Booking items per request TODO | Per submission | TODO | No | Apps Script writes are not transactional; interruption outside caught paths may leave inconsistent views. Canonical persistence design is required. |
| MNK, Angel Court, CFC, Demo Booking Platforms | Initial page/config payload | Suspected larger load as menus and UI grow | TODO | Full public site config/menu is rendered for the client; client and style files are large | HTML render plus embedded/configured catalogue | Menu/payload size TODO | Every page load | TODO | Maybe | Measure HTML/config size and first render; no runtime defect is yet confirmed. |
| Demo Booking Platform | Post-submit notification and feedback | Suspected added completion latency/failure surface | TODO | Performs operational notification and demo feedback work after persistence | Mail service calls after Sheet writes | TODO | Per demo submission | Low/TODO | Maybe | Demo-only; must not drive production architecture. |
| Angel Court legacy fallback | Gmail/XLSX to booking transformation | Suspected scan/parse latency | TODO | Uses dashboard Gmail search, Drive conversion and workbook parsing instead of direct object submission | See dashboard-family scan/parser rows | TODO | Only legacy email submissions | TODO | Maybe | Preserve fallback but converge its output on the canonical contract. |

## Large or Overloaded Files

- `Script.html`: approximately 1,415–1,585 lines; combines state, rendering, filtering, modals, settings, remote calls, and workflow orchestration.
- `Styles.html`: approximately 1,113–1,279 lines.
- Shared parser: approximately 792 lines; The Line parser approximately 1,003 lines.
- Quote engines: approximately 578–787 lines.
- Configuration files: approximately 655–672 lines.
- The Line Gmail scanner: approximately 536 lines; other scanners approximately 387–411 lines.
- Booking-platform `Styles.html`: approximately 2,034–2,320 lines.
- Booking-platform `Script.html`: approximately 791–848 lines.
- Booking-platform Sheet services: approximately 411–524 lines.

File size is a maintainability/regression signal, not a measured runtime defect.

## Measurement TODOs

- Record first/second load time and returned record/payload counts per variant.
- Record settings reads and cache behaviour per representative action.
- Measure Gmail search, attachment conversion, parse, and write phases separately.
- Measure quote generation, folder resolution, document fill, PDF conversion, and Calendar attachment phases.
- Measure The Line initial scan, revision scan, and manual rescan separately.
- Measure MNK bulk quote and recharge workflows with realistic row counts.
- Record Apps Script service-call counts, quotas, failures, and retry behaviour.
