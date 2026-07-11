# Repository Standards

## Purpose

Every active FIKA Platform repository should be understandable, testable, recoverable, and safe for human- and AI-assisted development. These standards define the target; existing repositories should adopt them incrementally.

## Required root files

| File | Requirement |
|---|---|
| `README.md` | Purpose, lifecycle, users/owner if confirmed, architecture summary, setup, configuration, local validation, release and recovery guidance |
| `AGENTS.md` | Repository-specific working instructions, scope, constraints, commands, sensitive areas and completion checks |
| `.gitignore` | Excludes secrets, local configuration, generated output and transient files without hiding required source |
| Change record | `CHANGELOG.md` or an explicitly documented equivalent where release history is useful |
| Licence/ownership notice | TODO: confirm organisational requirement |

Never commit credentials, private keys, tokens, production identifiers intended to remain private, private customer data, or local deployment state.

## Recommended folder layout

Repositories may adapt this structure to their size, but responsibilities must remain discoverable.

```text
docs/
  decisions/
  runbooks/
schemas/
fixtures/
src/
  domain/
  workflows/
  repositories/
  adapters/
  configuration/
  ui/
tests/
scripts/
```

- `domain`: business concepts and pure rules.
- `workflows`: application orchestration and use cases.
- `repositories`: interfaces plus clearly separated implementations.
- `adapters`: external, legacy, provider, file, notification, and projection mappings.
- `configuration`: safe configuration definitions and validation; secrets remain external.
- `ui`: presentation and interaction logic.
- `scripts`: repeatable development/release utilities, not undocumented production behaviour.

Small repositories may flatten folders. The README must explain deviations.

## Shared packages

- Create a shared package only when business meaning is demonstrably shared, its consumers and ownership are known, and a stable contract can be tested independently.
- Keep domain-neutral utilities separate from domain workflows.
- Use explicit versions and compatibility notes for consumed packages.
- Do not create a shared package merely because files look similar.
- Avoid tiny packages that increase release coordination without meaningful ownership.
- A breaking shared-package change requires migration guidance and coordinated consumer verification.
- TODO: Decide package publication, versioning, and dependency-update mechanics.

## Documentation expectations

The README should answer:

1. What business capability does this repository provide?
2. What is authoritative, projected, or adapted?
3. What are its supported inputs, outputs, and dependencies?
4. How is it configured without exposing secrets?
5. How can a developer validate a change safely?
6. How is a release performed and rolled back?
7. What failures require manual recovery?
8. Which facts or ownership questions remain TODO?

Architecture diagrams should clarify material relationships, not decorate simple flows. Runbooks should cover significant operational and recovery tasks. Documentation changes belong in the same review as the behaviour they describe.

## `AGENTS.md` usage

- The root `AGENTS.md` applies to the whole repository. Nested files may add stricter instructions for a subtree.
- It must tell an agent what to read before editing, what is in/out of scope, which commands verify work, and which operations require explicit authority.
- It must identify production-sensitive files, generated files, secret/configuration boundaries, and deployment restrictions.
- It must require preservation of unrelated user changes and prohibit invented production facts.
- It should stay concise and operational. Architecture belongs in shared docs and ADRs.
- Update it when repository structure, commands, risks, or ownership change.

## ADR process

Create an ADR when a decision materially affects domain boundaries, source-of-truth, schemas, integration contracts, storage abstraction, security, reliability, migration, or several repositories.

Each ADR includes:

- title and sequential identifier;
- status: Proposed, Accepted, Superseded, Rejected, or Deprecated;
- date and decision owner, or TODO;
- context and evidence;
- decision and boundaries;
- consequences and trade-offs;
- alternatives considered where meaningful;
- unresolved decisions;
- migration/rollback implications;
- links to superseded or dependent decisions.

Do not rewrite accepted history. Supersede it with a new ADR and cross-link both records.

## Repository health expectations

- A clean checkout can be understood and validated using documented steps.
- Generated output is reproducible and not manually edited unless explicitly required.
- Dependencies are intentional and reviewable.
- Tests and fixtures are colocated or linked clearly.
- Default branches are protected according to organisational policy. TODO: confirm enforcement mechanism.
- Obsolete repositories and archives are retained or retired only through an approved retention decision.
