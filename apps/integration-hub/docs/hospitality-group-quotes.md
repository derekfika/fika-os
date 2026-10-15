# Hospitality grouped quotes

Owner: Integration Hub Hospitality domain. Consumer: Hospitality Booking dashboard.
Base: `release/production-final-2`, `cf8204de6e436ef325a6397b4d0683f3f92e92ac`.

## Persistence and commands

`POST /api/hospitality-booking-groups/quote` takes `bookingGroupId`, `expectedVersion` (0 before the first quote), and `expectedSourceHash`. Hospitality forwards the authenticated session through `/api/booking-groups/quote`. The Hub validates and authorises the resolved membership before preparing any record. It repeats those checks before finalising.

`fikaHospitalityBookingGroups/{sha256(groupId)}` holds the group ID, monotonically increasing quote version, latest quote ID and last completed quote ID. It is a commercial coordination record, not a replacement operational Booking.

`fikaHospitalityGroupQuotes/{quoteId}` holds schema `fika.hospitality-group-quote.v1`, group ID, revision, source hash, child IDs, original child versions/commercial versions, immutable ordered quote-engine snapshots, summed totals, creator/timestamps, artifact destination, pre-generated Drive file ID, PDF MD5, verified Drive URL, attempts, lease and status. The deterministic ID contains the group identity hash and commercial intent hash. Historical records and artifacts are retained.

## State and recovery

1. A Firestore transaction validates the complete group, expected source/version and existing commercial quote guards, freezes the snapshots and records `artifact_pending` plus its audit evidence.
2. A transaction claims a 180-second lease. Another request returns the existing state while that lease is active. An expired lease can be reclaimed by an authorised retry of the same command.
3. Reserve a Drive binary-file ID using `files.generateIds`, then persist it before any file upload. Render through the existing PDF runtime. Persist the PDF MD5 before creating the file at that reserved ID.
4. Check the file by direct ID, expected source-hash property, folder, MIME type, non-empty size and the persisted PDF digest. A retry that finds the verified file reuses it without rendering or uploading again. A duplicate create returns 409 for the same ID; it cannot allocate another file.
5. One final transaction revalidates membership, current commercial hash, authority and lifecycle guards. It commits the group as `complete`, updates the head, and installs **all** child section references in their existing `quoteState` together. Each section uses its own snapshot and derivative section ID but links the same group document, Drive file and group quote ID. New/Reviewed/Quoted children become Quoted; Completed children remain Completed. No CPU or notification command is dispatched.

External services are not part of the Firestore transaction. Render/upload/DB-finalisation failures become durable `failed` states with the same intent and reserved file ID. An upload whose response was lost, or an upload followed by failed DB finalisation, is recovered by the next POST. A process crash leaves the intent pending until its lease expires and it is retried. Recovery is operator initiated; this change adds no scheduler or automatic background writes.

If source or latest group intent changes while rendering, the old attempt becomes `superseded` with its historical artifact retained; no child quote references are installed. Integrity mismatches become terminal `integrity_failed`, are never overwritten or silently rebuilt, and require administrator investigation. A pending/failed/stale quote is never exposed as the group's current quote. A catastrophic database outage may prevent recording failure; the already durable pending intent and file ID still support recovery.

The Drive design follows Google's [pre-generated upload ID contract](https://developers.google.com/workspace/drive/api/guides/manage-uploads#use_a_pre-generated_id_to_upload_files).

## Commercial evidence and compatibility

No catalogue or current fee policy is read by the composer. Current child quote-engine snapshots are authoritative. Otherwise use stored item `lineTotal`, stored net/VAT and validated booking-owned additional charges. For charge amendments, retain the previous captured policy charges and replace its manual charges with the current stored charges. Do not multiply current catalogue prices or apply today's fee policy.

Historical net-only records stay net-only: their recorded VAT remains zero and is labelled **VAT as recorded**, rather than assuming a new VAT rate or fee. The consolidated total is the sum of these authoritative service sections. Unexplained or irreconcilable totals are not silently repriced: conflicting totals fail validation and remain visible with a warning. This is not a tax-policy migration.

Group membership requires structured `bookingGroup.id`, a complete unique sequence `1..size` (maximum 12), unique child IDs and matching customer, provider, site, OPLOC and event date. Names/dates/references never establish membership. Existing historical groups need no migration: GET derives the projection without writes; the first authorised quote POST materialises its coordination records. Invalid, incomplete or workspace-truncated groups remain visible as services with warnings and cannot be quoted as a complete group.

## Projection, status and operations

The Hub workspace response retains `bookings` for compatibility and adds `bookingGroups` plus `dashboardBookings` (ordinary bookings only). Hospitality uses these for the list and calendar, with children inside the ordered group schedule and labelled service drill-down. CPU routing warnings aggregate without changing per-child routing decisions.

Status precedence:

- All children Cancelled: Cancelled.
- All children Completed: Completed.
- Different child operational states: Partially processed.
- Uniform active state with current pending/retryable quote: Quote preparing.
- Uniform active state with complete matching group quote: Quoted.
- Uniform New/Reviewed state without a current group quote: New.
- Other states: Partially processed.

The commercial quote state is also shown separately. Child amendments/charge changes invalidate group freshness through the commercial hash. Group-level editing/cancellation and child editing/cancellation from grouped drill-down are deliberately unavailable in this correction. Child production/menu/allergen/charge operations keep their existing governed paths. Standalone quote/PDF creation is rejected for grouped children so clients cannot create several customer PDFs. Ordinary bookings retain the existing single quote flow.

## Runtime and cost

Hub now needs the same PDF renderer URL/token and OPLOC Drive owner credentials previously consumed by Hospitality: `FIKA_PDF_RENDERER_URL`, `FIKA_PDF_RENDERER_TOKEN`, `GOOGLE_WORKSPACE_DWD_SERVICE_ACCOUNT_JSON`, `GOOGLE_DRIVE_OWNER_EMAIL_OPLOC_<OPLOC_KEY>` and a quote folder from dashboard settings or the governed owner's configured root. Missing configuration fails closed and can be retried after configuration is supplied. No production settings/secrets are modified by this task. Confirm these settings on the Hub before a staging rollout; the release baseline's staging configuration does not currently declare them.

The new cold/warm workspace read cost is the same: at most one head document and one latest quote document per candidate group, in batched direct reads, in addition to the existing bounded workspace query. There are no new listeners, recurring writes or shorter polling intervals. A quote command uses at most 13 matching child documents per membership query, one head and one known intent document; completion revalidates the same bounded group. Intermediate checkpoints read one known intent document. Authorisation is deduplicated by governed OPLOC. This requires only the existing automatic single-field index on `bookingGroup.id`.

Audit records in `fikaBookingAudit` are appended atomically at prepare/claim/failure/supersession/completion boundaries, with actor, group/quote/revision, source hash, child IDs/commercial versions and attempt. Final child histories retain group quote lineage. Reads and unchanged replays do not write business audit records.

## Validation and release decision

- Hospitality: `npm test` — 171 passed; `npm run typecheck` and `npm run build` passed.
- Hub: `npm test` — 625 total, 612 passed, 12 failed, 1 skipped. The 14 new grouped quote tests passed, including actual Firestore transaction/CPU hand-off coverage on a fresh, isolated emulator at `127.0.0.1:9185`, project `demo-fika-os` (`FIKA_GROUP_QUOTE_EMULATOR_TEST=true`). `npm run typecheck` and `npm run build` passed.
- Exact release baseline, same isolated environment: 611 total, 598 passed, identical 12 failures, 1 skipped. Failures concern address/readiness documentation, OPLOC boundary/completeness expectations, Connections UI contracts, Delivered-In access expectations, Logistics trace source contracts, service-definition package contracts and staffing UI source contracts. None were changed by this task.
- A local two-page PDF was generated through the shared Chrome runtime and every page inspected. Group references, service boundaries, totals, recorded allergen states and footer fit without clipping. Drive writes were exercised through a fault-injecting adapter, not through a live customer account.

NO-GO for an unconditional release merge/deployment: the inherited Hub failures need resolution or explicit acceptance, and Hub renderer/OPLOC Drive configuration needs to be supplied and verified for staging. The implementation is ready for review on its focused branch; this task makes no merge or deployment.
