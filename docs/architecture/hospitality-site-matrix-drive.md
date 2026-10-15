# Hospitality site-aware allergen-matrix Drive storage

Task: Add site-aware governed allergen-matrix Drive storage for Hospitality.
Date: 2026-10-15. Branch: `codex/hospitality-uat-integration`.
Starting candidate: `cd348f2d08618392794e1d06b05c21d18fe7d69f`.
Recorded `origin/main`: `3a3c51d91cba03f9ad95c0985ea1853568234651`.

## Storage contract and precedence

Hub owns the booking, dashboard settings and canonical OPLOC authority.
Hospitality owns the Drive adapter. CPU still owns signing, release validity,
materialisation and Production Order linkage; none of that code changes.

The existing authenticated `/api/production?canonicalId=...` read accepts an
optional `includeMatrixStorage=true`. Its additive `matrixStorage` response
contains only the canonical OPLOC and existing dashboard `googleMatrixFolderId`
for Hospitality orders, or `cpu-default` for other origins. Internal-token and
browser actor/permission checks remain in place. Ordinary reads are unchanged.
The adapter accepts no browser-selected folder, owner or OPLOC.

1. Load the order's canonical source booking and its existing dashboard settings
   with `getDashboardQuoteSettingsForBooking`.
2. Resolve booking and order destination OPLOCs through Hub canonical merge
   records and the existing `resolveOplocId` authority. Reject missing, inactive,
   cyclic or conflicting identities. Historical IDs resolve to the current
   OPLOC owner key; booking/order mismatch never selects another site's folder.
3. Prefer dashboard `googleMatrixFolderId` over the existing
   `GOOGLE_DRIVE_ROOT_FOLDER_ID_OPLOC_<NORMALIZED_ID>` binding.
4. A site destination requires its existing
   `GOOGLE_DRIVE_OWNER_EMAIL_OPLOC_<NORMALIZED_ID>` binding, resolved through
   `resolveDriveOwner`, and DWD credentials. A missing/invalid/placeholder owner,
   invalid folder or inaccessible destination fails; neither identity nor folder
   is retried using CPU. Local OAuth cannot impersonate a governed site owner.
5. Without site-specific matrix configuration, retain `APP_CPU_PRODUCTION`,
   `GOOGLE_DRIVE_CPU_PRODUCTION_FOLDER_ID`, then the existing CPU root/default
   hierarchy in the unmodified PDF adapter. Other Production origins keep this
   behavior regardless of their destination OPLOC.

Copied Drive folder URLs remain supported. Weekly `WC_<date>` folders, PDF bytes,
release fingerprint metadata, file reuse/update and the `{saved}` response are
unchanged. Hospitality fails closed if an older Hub cannot return its storage
context; coordinated deployment must introduce the Hub contract first.

Read budget: the opt-in Hospitality path adds one known booking read, one known
dashboard read and normally one known OPLOC read. Redirects are bounded to ten
hops per identity, sharing a request-local record cache. Cold/warm requests have
the same bounded shape; no scans, polling, Firestore writes or audit writes are
introduced. Other origins and ordinary queue reads add no configuration reads.

## Validation

- Hospitality `npm test`: 189/189 passed, including nine new matrix tests and
  existing PDF release-metadata/reuse coverage.
- Hub focused suites: 64/64 passed (new matrix context, internal auth, OPLOC
  merge, routing, canonical catalogue, Drive routing, projection boundaries,
  production materialisation contract). Seven new provider tests cover site
  isolation, redirects, mismatch, inactive/missing/cyclic IDs and defaults.
- Both apps: `npm run typecheck` and `npm run build` passed.
- `git diff --check`: clean.
- Additional CPU release/signing/configuration checks: 34/36 passed. Two existing
  source-text assertions in `allergen-signing-lineage.test.ts` fail on this CRLF
  checkout because their `\n\n  const retryCheckpoint` slice delimiter is absent;
  the slice incorrectly includes later `startSave` references. Normalizing the
  inspected text to LF finds the delimiter and excludes those references. The
  test and all inspected CPU files are unchanged from the starting candidate.
  No CPU test or implementation was altered to hide these failures.
- The full Hub suite and emulator integration were not rerun for this bounded,
  read-only context addition; this is not a claim that the full repository is
  green. CPU was not rebuilt because no CPU source/contract consumer changed.

## Non-mutating staging preflight

Project: `fika-os-dev` only. Cloud Run traffic metadata verified these active
revisions during the check (neither contains this un-deployed change):

- Hospitality: `fika-hospitality-staging-build-2026-10-15-010` (100% traffic).
- Hub: `fika-os-staging-build-2026-10-15-009` (100% traffic).

The active Hospitality staging DWD credential was loaded in memory. The exact
candidate resolver was given the task-supplied site settings and owner bindings
in memory; no runtime environment or dashboard document was changed. Only OAuth
token exchange and Drive metadata GETs were performed, with no artifact request.

| Site | OPLOC | Selected owner | Selected matrix folder | Access result |
|---|---|---|---|---|
| RCoA | `oploc:be0becbe-b6cf-4d7f-9c1e-f36e689feab2` | `rcoa@fikacatering.com` | `1-RuVcoHccoKDuk3kBym-5n3RuF9ncn3X` | HTTP 200, active folder, `canAddChildren=true` |
| Angel Court | `oploc:24a93500-d75d-4fe0-8beb-672d36f9da10` | `seven@fikacatering.com` | `1H3U3JxbECLYfgUSVJxkeQfI3CQ5ooD6X` | HTTP 200, active folder, `canAddChildren=true` |

Both adapter selections matched their supplied site folder and owner. No secret,
token or service-account key was logged. No customer artifacts were created.

**Runtime recommendation: BLOCKED for staging UAT.** Both site owner bindings
and both matrix destinations remain absent in active Hospitality staging:

- `GOOGLE_DRIVE_OWNER_EMAIL_OPLOC_BE0BECBE_B6CF_4D7F_9C1E_F36E689FEAB2`
- `GOOGLE_DRIVE_OWNER_EMAIL_OPLOC_24A93500_D75D_4FE0_8BEB_672D36F9DA10`
- `googleMatrixFolderId` in dashboard `rcoa-hospitality`
- `googleMatrixFolderId` in dashboard `angel-court-hospitality`

The corresponding OPLOC root environment bindings are also absent, so no
alternative governed site destination is currently available. A separately
authorized configuration step can set each dashboard matrix folder (preferred)
or its existing OPLOC root binding, plus the site owner binding above. The code
change is ready for review; this report does not authorize merge or deployment.

No merge, deployment, configuration change, Firestore mutation, migration,
catalogue merge or production access occurred.

## Changed files

- `apps/hospitality-booking/app/api/allergen-matrix/drive/route.ts`
- `apps/hospitality-booking/lib/matrix-drive-storage.ts`
- `apps/hospitality-booking/tests/matrix-drive-storage.test.ts`
- `apps/hospitality-booking/tests/drive-ownership.test.ts`
- `apps/integration-hub/app/api/production/route.ts`
- `apps/integration-hub/lib/hospitality-matrix-storage.ts`
- `apps/integration-hub/tests/hospitality-matrix-storage.test.ts`
- `packages/server-shared/src/hospitality-matrix-storage.ts`
- `packages/server-shared/package.json`
- `docs/architecture/hospitality-site-matrix-drive.md`
- `CHANGELOG.md`
