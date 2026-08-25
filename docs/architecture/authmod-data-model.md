# AUTHMOD data model (Phase A)

Status: proposed canonical model. Names are logical aggregates, not a commitment to a particular Firestore collection or SQL table.

## Identity and reference records

### AuthIdentity

id (immutable FIKA ID), externalProvider and externalUid (unique provider key), normalized email, display-name snapshot, optional legendId, identity-link status (unmatched, matched, needs-review), employment/status state, created/updated timestamps, provenance, and record version. Email changes update the attribute and provenance; they do not change id.

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

Normal application access is managed through a standard application bundle. The bundle atomically creates or updates this AppAssignment and the application's normal explicit AuthorityGrant records. Each generated grant carries bundleId and provenance standard-app-access. Revocation expires the assignment and those bundle-owned grants, while independently granted special authority remains preserved.

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

importId, row number/stable row hash, normalized input, candidate identity IDs with confidence/reason, selected identity ID if reviewed, proposed changes, unresolved fields, reviewer/decision/time and commit status. Low-confidence or unmatched rows remain visible and cannot be committed as an identity grant without an explicit resolution.

### AccessAuditEvent

Append-only event with event ID, timestamp, authenticated actor principal ID, actor display/email snapshot, target subject ID/type, action, before/after redacted state, affected scope IDs, source (authmod-ui, spreadsheet-import, system-migration, service), correlation/causation IDs, reason, outcome and schema version. Sensitive credentials and unnecessary personal data are excluded.

## Evaluation rules

For a human request, deny unless: identity is active; session is valid; app is enabled and assigned (or Full Access expands to it); requested OPLOC is assigned for a scoped capability; explicit action grant is active and within dates; and any separation-of-duties constraint passes. For a service request, use the service principal and service grant path only. Any missing store, malformed grant, stale version or dependency error is deny/503 according to whether the caller should retry.

## Storage and migration notes

Use the Integration Hub's canonical persistence boundary initially because it already owns Legend/OPLOC canonical records and server-side auth code. Keep AUTHMOD aggregates logically separate from ordinary canonical provider records. Access mutations should use optimistic versioning/idempotency and write durable state plus existing domain/audit evidence atomically where the store permits. Do not commit mutable local-data as AUTHMOD truth.
