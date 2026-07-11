# FIKA Platform Principles

## Purpose

These principles define the enduring architectural philosophy of the FIKA Platform. They guide decisions across the core operational platform and should change only when FIKA's long-term direction changes.

## Vision

The FIKA Platform should enable growth without a proportional increase in manual work, duplicated logic, or setup complexity. Each new location and operational capability should be easier to establish than the last because it builds on shared foundations.

Architecture exists to support dependable operations. Decisions should favour clarity, reuse, recoverability, and business continuity over novelty.

## Design Principles

- Design for the whole platform while delivering change in small, useful increments.
- Prefer clear boundaries, stable contracts, and explicit ownership.
- Reuse proven capabilities where the business meaning is shared.
- Keep genuinely different concerns separate rather than forcing superficial uniformity.
- Make assumptions, dependencies, and unresolved decisions visible.
- Base architectural change on evidence and measured need.
- Keep decisions reversible where practical.

## Public Experiences and Internal Operations

Public experiences may have distinct brands, audiences, journeys, and presentation. They should remain free to express those differences.

Internal operations should converge around shared records, rules, and workflows. Separate public channels should not create separate operational truths. Where several channels represent the same business activity, they should feed a common internal operational model.

## Canonical Schemas

Core business concepts should have canonical, versioned definitions that are independent of any single interface, storage layout, site, or external provider.

Canonical schemas should use stable identities, explicit required and optional fields, consistent timestamps and statuses, validation rules, ownership, and a declared source of truth. Provider-specific details should remain outside canonical objects unless they are essential to the business meaning.

Schemas are shared contracts. Changes to them must be deliberate, documented, and compatible with the workflows and records that depend on them.

## Shared Workflows

A business action with the same meaning across the platform should have one authoritative definition. Applications should request that action through a shared contract rather than independently recreating its rules.

Shared workflows should produce consistent outcomes, resist duplicate operations, preserve auditability, and make failure behaviour clear. A workflow should be centralised only when its business meaning is genuinely shared and the migration risk is understood.

## Configuration Over Duplication

Differences between sites, clients, providers, permissions, branding, and enabled capabilities should be expressed as configuration wherever they do not represent different business behaviour.

Configuration must be authoritative, understandable, and separated into safe information and private information. New locations should reuse platform capabilities through configuration instead of copied code or scattered hardcoded assumptions.

## Source-of-Truth Philosophy

Every important business record and configuration value should have explicit ownership and an identified authoritative source. Reports, administrative surfaces, caches, integrations, and operational views must not silently become competing truths.

The platform may use multiple representations of the same information, but their roles must be clear: origin, authority, transformation, view, cache, or history. Duplication should be intentional, traceable, and governed by a defined direction of update.

## Performance Philosophy

Performance decisions should begin with measurement. Optimisation should address observed user impact and known operational limits rather than assumptions.

The platform should avoid unnecessary work, repeated retrieval, oversized transfers, and repeated reconstruction of unchanged information. Responsiveness, correctness, and maintainability should be considered together; a faster system that is harder to trust is not an improvement.

Architecture should evolve when evidence shows that current constraints no longer meet operational needs.

## AI-Assisted Development Philosophy

AI supports development but does not supply missing business facts. It must inspect the relevant context before proposing or making changes, preserve established terminology and boundaries, and label uncertainty rather than inventing production behaviour.

AI-assisted changes should be scoped, reviewable, tested in proportion to risk, and accompanied by clear summaries and unresolved decisions. Architectural knowledge should be recorded in shared documentation so future work depends less on repeated explanation and more on verified context.

AI must not expose secrets, silently broaden scope, or change production systems without explicit authority.

## Gradual Migration Philosophy

Working systems should not be rewritten without a clear, evidence-based reason. Migration should preserve business continuity and proceed through small, reversible steps with defined checks and rollback expectations.

Existing systems may continue to operate while shared schemas, configuration, and workflows are introduced around them. Consolidation should follow understanding; inventory and measurement come before centralisation.

Technology and storage choices should change only when demonstrated needs justify the operational cost and risk.

## Security Philosophy

Security is a platform responsibility, not an application afterthought.

Credentials, tokens, private keys, passwords, and other secrets must remain outside repositories and public configuration. Access should follow explicit permission boundaries and the principle of least privilege.

Important actions and changes should be auditable. The platform should define safe failure behaviour, protect against unintended duplicate actions, and maintain appropriate backup, recovery, release, and rollback practices.

Documentation and examples must never expose production secrets or sensitive production data.

## Operational Friction Principle

Architecture should remove repeated operational effort at its source. Re-keying, reconciliation, duplicate setup, avoidable hand-offs, and reconstruction of known facts are signals that a shared record, workflow, or configuration boundary may be missing.

Automation should reduce friction without hiding responsibility. Where human judgement remains necessary, the platform should present the relevant context, make the decision explicit, and preserve an audit trail.

## Storage Independence Principle

Business meaning must not depend on a particular storage product or physical layout. Canonical records, domain rules, and workflow contracts should be defined independently from tables, files, sheets, folders, or provider-specific identifiers.

Applications should access authoritative records through clear repository boundaries. Storage remains an implementation decision that may evolve without redefining the domain.

## Automation Philosophy

Automate stable, understood processes with explicit triggers, inputs, ownership, outcomes, and failure behaviour. Automation must be safe to retry, resistant to duplicate actions, observable, and capable of handing unresolved cases to people without losing context.

Do not automate uncertainty by turning assumptions into hidden rules. First make the business decision visible; then automate the confirmed rule.

## Growth Philosophy

Growth should come primarily through reusable capabilities, configuration, and stable contracts rather than copied applications and proportional administration. Each additional site, client, channel, or domain should strengthen shared foundations while retaining justified business differences.

The platform should support increasing volume and organisational complexity through measured evolution, not premature scale assumptions.

## User Experience Philosophy

User experiences should reflect the user's task and vocabulary, minimise duplicate entry, and make status, next actions, exceptions, and ownership clear. Public, client-facing, and internal experiences may differ, but should remain consistent with the same underlying business facts.

Reliability and clarity are part of the experience. Interfaces should respond predictably, preserve user work, explain recoverable failures, and avoid exposing implementation detail where it does not help the user act.

## Decision Test

Future architectural decisions should be judged by whether they:

1. Reduce future duplication and manual setup.
2. Strengthen canonical business meaning and ownership.
3. Preserve appropriate separation between public experience and internal operations.
4. Improve reliability, security, performance, or recoverability based on evidence.
5. Support gradual adoption without unnecessary disruption.
6. Make the next FIKA location or capability easier to establish than the previous one.
