# Beverage-only staging OPLOC entitlement

The owner approved a Beverage View test across the active canonical staging OPLOC inventory. The site decision uses an explicit direct `AuthorityGrant` for one already-bound Firebase person. A separate Beverage `AppAssignment` establishes app admission. Generic `SiteAssignment` records also affect existing scoped apps, so this procedure leaves them alone. The entitlement is specific to Beverage View.

This procedure records the required operator evidence for a later hosted activation. Registry provisioning and subsequent person-specific entitlement changes are separate reviewed operations.

## Prepare the hidden staging registry

Use the reviewed merged revision in `apps/integration-hub` and existing user Application Default Credentials for an authorised staging operator. The command verifies the ADC account through Google UserInfo and matches its verified email and Google subject to an existing verified Firebase user. It requires one active AUTHMOD person bound to that UID and a current direct organisation-scoped AUTHMOD Administer grant. A missing or ambiguous binding stops the command.

```powershell
$env:FIKA_RUNTIME_MODE = "staging"
$env:FIREBASE_PROJECT_ID = "fika-os-dev"
$env:FIKA_SNAPSHOT_BUCKET = "fika-os-dev-staging-read-packages-europe-west4"
npx --no-install tsx scripts/provision-beverage-staging-registry.ts
```

Review the plan before running the same command with `--execute` in the isolated staging project. Use a quiet window for AUTHMOD reference package maintenance. Execution creates the fixed View-only entry, a canonical audit receipt and the applications cache head in one Firestore transaction. The receipt records the verified actor and the owner-approved staging scope. The command then rebuilds the existing AUTHMOD reference package if missing or stale and verifies the published entry. It does not assign Beverage access.

An exact repeat reuses the receipt and verifies the current package. A conflicting registry or receipt stops without overwrite. If execution reports `references: "unverified"`, check the recorded receipt before retrying package publication. A package integrity failure requires separate governed recovery.

## Before making the two reviewed commands

1. Verify the exact staging project, the serving Hub SHA, the current AUTHMOD and OPLOC package heads, the revocation-checked session and the dedicated Beverage workload caller. Confirm the Hub read surface can serve current snapshots without binding identities or rebuilding packages. Record the owner decision and scope in the governed activation record.
2. Resolve the approved reviewer's existing, uniquely bound Firebase UID to one active AUTHMOD person and retain the account version. Verify this through the approved staging identity workflow. An email address by itself supplies no binding or grant. External Gmail access requires individual authorization, verified enrollment and separate scope.
3. Use the [operator-only current inventory command](beverage-reference.md#operator-only-current-oploc-inventory) and record the verified source version, time, count, hashes and sorted unique IDs. Recheck the inventory immediately before submitting. If the inventory exceeds 100 or the Beverage transport limit, stop this all-sites procedure for an explicitly reviewed scope or contract change. Do not truncate the inventory or assign a wildcard.
4. Verify the reviewed hidden registry record for `beverage-innovation` is present in the isolated staging project. It must be enabled, `launchVisible: false`, `scopeModel: "oploc"`, `standardBundleId: "beverage-innovation-normal"`, `standardResource: "beverage-innovation.normal"` and `standardActions: ["View"]`. Registry provisioning remains a separate governed action. Record the reviewer's current generic SiteAssignments and other app scope for the before/after comparison.

## Audited operation

1. In the existing authenticated AUTHMOD account command, `POST /api/authmod/accounts/{identityId}/actions`, use `action: "app"`, `appId: "beverage-innovation"` and `enabled: true` if an effective Beverage admission is missing. Supply the reviewed identity `expectedVersion`, a specific owner-authorized reason and any reviewed access period. This records admission and the registry's standard organisation View grant. The standard grant cannot satisfy a Beverage site decision.
2. Refresh the account and confirm the admission is effective. Submit `action: "authority-grant"` on the same endpoint with `appId: "beverage-innovation"`, `resource: "beverage-innovation.normal"`, `authorityAction: "View"` and `scope: { kind: "oploc", ids: [<exact reviewed IDs>] }`. Supply the refreshed `expectedVersion`, a specific reason referencing the owner decision and any approved effective dates. Use one explicit View grant covering the complete reviewed inventory. AUTHMOD validates each exact ID against its active canonical record, sorts the scope and uses a fixed-length document key. The grant and its audit event commit atomically and invalidate the previous access package.
3. Record the resulting assignment and grant IDs, actor, scope, grant version, audit events and current access package version. If publication or the response is uncertain, read the authoritative grant and audit first. Do not repeat the command based on a missing response. A missing or stale read package keeps Beverage access closed.
4. Verify through the exact deployed read-only surface that the reviewer can read every approved site and that an ungranted active site, an unbound identity and a different action fail closed. Compare the reviewer's generic SiteAssignments and existing app scope with the baseline. Confirm Beverage write routes remain hidden. Keep credentials out of the record.

Review inventory changes explicitly. A new active site does not enter the old grant. Historical aliases in an entitlement invalidate that entitlement; aliases in a request can resolve only to an already entitled active canonical target. To replace an entitlement, revoke the superseded grant with the existing audited `authority-revoke` command and verify the current package after provisioning. A removed site cannot authorize an active-site request. For withdrawal, revoke the grant and remove the Beverage app assignment if admission itself should end.

Approval, hosted Food Data, functional staging persistence, operational effects and release have separate gates. #423 and #429 remain open.
