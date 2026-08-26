# AUTHMOD data model (Phase A)

Status: proposed canonical model. Names are logical aggregates, not a commitment to a particular Firestore collection or SQL table.

## Identity and reference records

### AuthIdentity

id (immutable FIKA ID), externalProvider and externalUid (unique provider key), normalized email, display-name snapshot, `identityKind` (`person` or `operational`), optional represented canonical OPLOC ID and operational purpose, optional person `legendId`, identity-link status (unmatched, matched, needs-review), employment/status state, created/updated timestamps, provenance, and record version. Email changes update the attribute and provenance; they do not change id. A person identity represents an identifiable individual; an operational identity represents an interactive Workspace account and is not a Legend or service principal.

### CustodianAssignment

Separate effective-dated aggregate linking an operational AuthIdentity to one primary canonical Legend custodian. Custody can change while the operational identity ID, account, access history and audit history remain stable. Custodianship is governance metadata only and grants no application, site or authority access.

Legend linkage is explicit and reviewable. BrightHR-created Legends enter AUTHMOD as active candidates with no access grants. Matching may use provider UID/email and reviewed evidence; name-only matches are suggestions, never silent authorization.

### ApplicationRegistry

appId, name, route/base URL, enabled, launchVisible, scope model (none, oploc, mixed), metadata, version and audit fields. Seeded from one registry, not per-app hardcoding.

### OplocReference

Canonical OPLOC ID, approved label/address snapshot, lifecycle/publication state and provenance. A one-off destination is not a permanent OPLOC; it belongs on the request/order snapshot instead.

## Access records

### SiteAssignment

id, identityId, oplocId, status, effectiveFrom/effectiveTo, source, reason, grantedBy and version. A Full Access expansion may use an explicit all-normal-sites policy, but evaluation must exclude archived/withdrawn OPLOCs and never fabricate a site.

### AppAssignment

id, identityId, appId, status, effective period, optional scope policy, source, grantedBy and version. App assignment alone does not authorize a site-scoped request.

Normal application access is managed through a standard application bundle. The bundle atomically creates or updates this AppAssignment and the application's normal explicit AuthorityGrant records. Each generated grant carries bundleId and provenance standard-app-access, uses the registered normal resource, and has organisation scope; it never snapshots current OPLOC IDs. Revocation expires the assignment and those bundle-owned grants, while independently granted special authority remains preserved. Current SiteAssignments are evaluated separately for every requested OPLOC.

### AuthorityGrant

id, subject type/id (identity or service principal), action from the six-value vocabulary, resource/capability, app/domain, scope reference(s), effective period, status, optional assignment/role reference, grant reason, granted/revoked by, version and provenance. Explicit grants are preferred over role expansion in the evaluator. Publish and Approve never inherit from Manage or Administer.

### AccessProfile flags

fullAccess and authmodAdmin are understandable UI projections of grants/policies, not a replacement for grants. fullAccess expands only normal launch-critical app/site access. authmodAdmin maps to authmod.admin and remains independent.

### RoleCatalogue and Assignment (optional v1 foundation)

The role catalogue can be stored now for future governed bundles: role ID, owner, purpose, status and version. A person-to-role Assignment is effective-dated and scoped, but does not itself authorize anything. Role bundles may preselect grants for admin review later; no BrightHR/job-title automation is permitted.

## Service principals

### ServicePrincipal

id, stable name, owning domain, description, status (active, revoked, expired), allowed audience/resource, credential/key metadata (never secret material), effective dates, created/updated/provenance and version. Each credential has key ID, created/last-used/expiry/revoked timestamps and rotation metadata. Requests identify the principal and credential key; authorization evaluates service grants separately from humans.

## Import and audit

### ImportRecord

id, source kind/file name/hash, uploaded by authenticated actor, uploadedAt, parser/schema version, row count, source snapshot reference, status (uploaded, previewed, committed, rejected, superseded), reconciliation summary, commit ID and errors. Raw credentials are never stored.

### ImportRowResolution

importId, row number/stable row hash, normalized input, candidate identity IDs with confidence/reason, selected identity ID if reviewed, proposed changes, unresolved fields, reviewer/decision/time, appliedAt/appliedBy/commit idempotency key and commit status. Each row must be accepted/applied, explicitly excluded, unresolved or blocked. Low-confidence or unmatched rows remain visible and cannot be committed as an identity grant without an explicit resolution. Bootstrap imports are merge-only: true grants/activations are proposed; false/blank app, site and special cells mean no change, while explicit Active/Full Access false values are meaningful updates. A committed import is final only when every row is accepted or explicitly excluded; otherwise it remains partial and can be resumed without reapplying applied rows.

Reviewed account reconciliation may add optional `Account Type`, `Represented OPLOC ID`, `Operational Purpose` and `Primary Custodian Legend ID` columns. These use canonical IDs where applicable; raw Workspace exports do not need to contain them, and email/display-name patterns never authoritatively classify or link an account.

### AccessAuditEvent

Append-only event with event ID, timestamp, authenticated actor principal ID, actor display/email snapshot, target subject ID/type, action, before/after redacted state, affected scope IDs, source (authmod-ui, spreadsheet-import, system-migration, service), correlation/causation IDs, reason, outcome and schema version. Sensitive credentials and unnecessary personal data are excluded.

## Evaluation rules

For an interactive request, deny unless: identity is active; session is valid; app is enabled and assigned (or Full Access expands to it); requested OPLOC is assigned for a scoped application/workflow request; explicit action grant is active and within dates; and any separation-of-duties constraint passes. Full Access is person-only. `authmod.admin` and `menu.publish` remain person-required policies enforced by the core evaluator and grant service, regardless of UI input. Menu publication and CPU allergen sign/final approval are explicit organisation-level special authorities, not OPLOC grants; the account may still need ordinary app/site access to reach the relevant workflow. CPU allergen authority may be granted to an authorised operational or person identity; AUTHMOD proves capability use, while the allergen record preserves the separate named/signature evidence of the human signatory. For a service request, use the service principal and service grant path only. Any missing store, malformed grant, stale version or dependency error is deny/503 according to whether the caller should retry.

## Storage and migration notes

Use the Integration Hub's canonical persistence boundary initially because it already owns Legend/OPLOC canonical records and server-side auth code. Keep AUTHMOD aggregates logically separate from ordinary canonical provider records. Access mutations should use optimistic versioning/idempotency and write durable state plus existing domain/audit evidence atomically where the store permits. Standard bundle grant/revoke uses one repository transaction for the assignment, bundle-owned grants and audit event. Runtime lookups use identity/app/site/grant keyed queries; administrative list views may use separately bounded queries. The Firestore adapter requires composite indexes for externalProvider plus externalUid on authmodIdentities, subjectId plus subjectType on authmodAuthorityGrants, and canonicalId plus entityType on integrationHubCanonical for targeted active-OPLOC checks. Do not commit mutable local-data as AUTHMOD truth.
