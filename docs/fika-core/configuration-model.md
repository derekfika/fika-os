# FIKA Core Configuration Model

## Purpose

Configuration expresses approved variation without copying applications or hiding different business behaviour. It is versioned, owned, validated, auditable and resolved independently from physical storage.

Configuration is not a substitute for canonical records, workflow state, secrets management or unresolved policy.

## Configuration scopes

### Global

- **Purpose:** Platform-wide defaults, supported capabilities, common policy references and shared vocabulary.
- **Owner:** Platform architecture/governance owner: TODO.
- **Examples:** default locale/time conventions, supported feature keys, common validation-policy references.
- **Must not contain:** site/client-specific behaviour, secrets or mutable business records.

### Brand

- **Purpose:** Identity and presentation defaults for FIKA or an approved client/experience brand.
- **Owner:** Brand/business owner: TODO.
- **Examples:** brand version/reference, tokens, typography, asset roles and white-label policy.
- **Must not contain:** booking rules, recipients, permissions or private provider values.

### Site

- **Purpose:** Approved variation for a stable FIKA/client site.
- **Owner:** Site operational owner with platform governance: TODO.
- **Examples:** enabled capabilities, catalogue/policy references, location defaults, operational labels and brand selection.
- **Must not contain:** copied application code, user-specific preferences or ungoverned external identifiers as domain identity.

### Application

- **Purpose:** Behaviour and presentation settings for one application capability/deployment context.
- **Owner:** Application/service owner: TODO.
- **Examples:** enabled modules, supported views, non-sensitive integration feature settings and projection policy.
- **Must not contain:** canonical business records, hardcoded site rules disguised as flags or secrets.

### User

- **Purpose:** Individual preferences that do not change shared business truth or permissions.
- **Owner:** User within organisational policy.
- **Examples:** display preferences, saved filters, accessibility preferences and notification preferences.
- **Must not contain:** role grants, authoritative status, shared workflow rules or credentials.

### Secrets

- **Purpose:** Sensitive credentials and private connection material required by authorised adapters.
- **Owner:** Security/operational owner: TODO.
- **Boundary:** Secrets are referenced by opaque configuration keys and resolved only within authorised execution. Values are never returned as normal configuration, committed, logged, copied into domain records or exposed to clients.

## Ownership and inheritance

Recommended effective-value order:

```text
Global defaults
  -> Brand defaults where presentation applies
  -> Site overrides
  -> Application overrides
  -> User preferences where explicitly permitted
```

Inheritance applies only to keys whose definition permits that scope. A user preference cannot override a business rule, permission or site authority. Brand and site precedence must be declared per key when both apply.

Every configuration key should define:

- stable key and description;
- data type and validation;
- allowed scopes;
- default and whether absence is valid;
- owner and approver;
- safe/private/secret classification;
- inheritance and override rule;
- compatibility/version policy;
- effective and retirement dates where needed;
- affected services/applications;
- audit and rollout requirements.

## Change lifecycle

1. propose change with reason and scope;
2. validate structure, references, permissions and compatibility;
3. review by owner/approver;
4. publish a version with effective timing;
5. resolve deterministically and expose safe diagnostics;
6. monitor affected workflows;
7. roll back or supersede, never silently rewrite history;
8. retire after consumers and retention are confirmed.

## Safe failure

- Missing required configuration blocks the affected action with an actionable error.
- Invalid overrides do not silently fall back when that could change business behaviour.
- The effective configuration version is recorded with important workflow results.
- Stale configuration changes use expected-version conflict handling.
- Applications may cache configuration only with version/invalidation semantics.

## Boundaries

- Catalogue content may have its own domain/repository; configuration references it.
- Permissions are evaluated by Permission Service; configuration supplies policy inputs only.
- Brand Service resolves brand; configuration selects context/overrides.
- Integration adapters own provider mapping; configuration supplies validated references.
- Operational projections may display effective configuration but are not its authority.

## Open questions

- TODO: Confirm configuration owners and approval forum.
- TODO: Define the initial key catalogue and scope matrix.
- TODO: Decide safe/private classification policy and secret-reference governance.
- TODO: Define effective-date, environment/context and emergency-change rules.
- TODO: Define compatibility, cache and rollback expectations.
