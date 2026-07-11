# FIKA Core Validation Model

## Purpose

Validation prevents structurally invalid, unauthorised, inconsistent or operationally unsafe work from entering authoritative workflows. Validation is layered because no single schema or interface can decide every concern.

Client-side feedback may improve experience but never replaces authoritative validation.

## Schema validation

- **Question:** Is the data structurally compatible with the declared contract version?
- **Owns:** Types, required/optional fields, formats, enums, ranges and closed/open object policy.
- **Runs:** At every external/adapter boundary and before persistence/publication.
- **Does not decide:** Business eligibility, permissions, current state or external existence.
- **Evidence:** Schema version, validator version and structured issues.

## Business validation

- **Question:** Is the proposed business state meaningful under approved domain policy?
- **Owns:** Pricing invariants, catalogue choices, notice/minimum rules, status eligibility, quantity/unit rules and domain-specific constraints.
- **Runs:** Inside the owning domain service using an explicit policy/configuration version.
- **Does not decide:** Actor permission or provider availability.
- **Evidence:** Rule codes, severity, field/item references and policy version.

## Workflow validation

- **Question:** May this action occur now against this record/version and process state?
- **Owns:** Preconditions, transition graph, idempotency, expected version, duplicate effects, amendment/cancellation cutoffs and dependency readiness.
- **Runs:** Before authoritative mutation and before irreversible effects.
- **Does not decide:** General role policy or structural shape alone.
- **Evidence:** Workflow/action code, source/current versions and actionable outcome.

## Permission validation

- **Question:** May this actor perform this action on this scoped resource?
- **Owns:** Role/grant/scope/condition evaluation and explicit denial.
- **Runs:** At authoritative query, command, configuration and administrative boundaries.
- **Does not decide:** Whether the resulting business state is valid.
- **Evidence:** Safe decision reason and policy version; sensitive policy details remain protected.

## External integration validation

- **Question:** Can external input/output be trusted and mapped, and is the dependency able to accept the request?
- **Owns:** Source authentication where applicable, provider format/reference mapping, capability/limit checks, response validation and retry classification.
- **Runs:** In adapters before canonical ingestion and after external responses.
- **Does not decide:** Missing business facts by assumption.
- **Evidence:** Adapter/version, stable source reference, mapping diagnostics and dependency outcome.

## Validation result model

A shared conceptual result should contain:

- status: valid, needs review or invalid;
- stable issue code;
- severity: information, warning or error;
- safe human-readable message;
- domain field or stable item/reference where relevant;
- validation layer and rule/policy version;
- validation time and actor/system reference;
- whether retry, correction, override or manual review is permitted.

Messages are presentation-ready summaries, not the sole machine contract. Stable codes drive automation. Validation results must not expose secrets or unnecessary personal data.

## Submission and revalidation

Preserve the validation result that applied when an authoritative version was created. Later policy changes may produce a separate revalidation/review result; they must not rewrite historical evidence or silently invalidate an accepted record.

Overrides require explicit permission, reason, actor, scope and audit. Some errors should never be overridable; policy owner TODO.

## Legacy input

Legacy adapters may emit `needs review`, unresolved mappings and missing acknowledgement evidence. They must not invent acceptance, catalogue identity, price, dietary allocation or customer facts. Original evidence and parser diagnostics remain outside the canonical aggregate under retention policy.

## Open questions

- TODO: Approve the initial validation-code catalogue and severity semantics.
- TODO: Define overrideable versus non-overrideable rules and approvers.
- TODO: Define submission validation versus later review/revalidation storage.
- TODO: Confirm validation retention, redaction and reporting policy.
- TODO: Define cross-service validation ordering and performance targets.
