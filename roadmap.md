# FIKA OS Roadmap

## Purpose

This roadmap defines the canonical nine-stage lifecycle from business vision to continuous discovery. It supersedes the former 19-step delivery numbering while preserving its useful delivery themes below.

## Vision

FIKA OS allows FIKA to grow without proportional increases in manual work, duplicated logic or setup complexity. Business knowledge is expressed once and reused through governed decisions, schemas, architecture and applications.

## Current position

```text
Stage 1 Vision                 Complete
Stage 2 Domain Discovery      Complete
Stage 3 Business Discovery    Complete — 54 canonical decisions, 100%
Stage 4 Business Decisions    Complete
Stage 5 Schema Design         Complete — Packs 1–8, freshly validated
Stage 6 Platform Architecture Complete — closed 2026-07-27
Stage 7 Implementation        Planned — awaiting governed increment selection
Stage 8 Validation/Rollout    Planned
Stage 9 Continuous Discovery  Planned ongoing governance
```

## Canonical stages

1. [Vision](docs/stages/stage-1-vision.md) — establish purpose, scope, principles and outcomes.
2. [Domain Discovery](docs/stages/stage-2-domain-discovery.md) — discover domains, journeys, evidence and questions.
3. [Business Discovery](docs/stages/stage-3-business-discovery.md) — resolve dependency-driven questions into approved decisions.
4. [Business Decision Records](docs/stages/stage-4-business-decision-records.md) — preserve context, exact decisions, rationale and consequences.
5. [Schema Design](docs/stages/stage-5-schema-design.md) — implement business meaning as versioned contracts.
6. [Platform Architecture](docs/stages/stage-6-platform-architecture.md) — define boundaries, composition, repositories and adapters.
7. [Implementation](docs/stages/stage-7-implementation.md) — build applications, services and workflows.
8. [Validation and Rollout](docs/stages/stage-8-validation-and-rollout.md) — prove behaviour and adopt safely.
9. [Continuous Discovery](docs/stages/stage-9-continuous-discovery.md) — govern new evidence and change.

## Stage gates

- Later stages consume earlier authority; they do not silently redefine it.
- A BDR must exist before a schema implements a business decision.
- A schema Pack must complete Stage 5, be integrated and be committed before it becomes an architecture or implementation dependency.
- Architecture must trace to BDRs and schemas.
- Implementation requires reviewed architecture and explicit scope.
- Rollout requires validation, operational readiness and authority.
- New evidence returns to the earliest affected stage.

## Preserved delivery themes

The former roadmap contained useful implementation planning. These are retained as themes within Stages 5–8 rather than competing stage numbers:

- canonical schema catalogue;
- central, governed configuration;
- measured performance improvement;
- shared FIKA Core services and workflows;
- Events foundation, internal Dashboard and distinct public experiences;
- connected Booking, Production, Logistics, Calendar, notification and reporting flows;
- local Codex/MCP context tooling and reusable development skills;
- starter applications and configuration-driven provisioning;
- provider-independent till integrations and migration tooling;
- evidence-led storage evolution;
- reliability, security, observability, backup and recovery;
- controlled Operational Location provisioning;
- remote-backend decisions only when demonstrated need justifies them.

These themes are not automatically authorised projects. Each must pass the applicable business-decision, schema, architecture, implementation and rollout gates.

The complete original wording is retained in the [historical 19-stage roadmap](docs/historical/legacy-19-stage-roadmap.md).

## Scope

The roadmap covers the core FIKA operational platform defined in [scope](docs/scope.md), including hospitality, Events, Production, Logistics, documents, communications, workforce workflows, till migration, reporting and shared platform capabilities.

Bloom, HomeBuck, personal projects and unrelated experiments remain outside scope.

## Success measures

The roadmap succeeds when:

- new Operational Locations and capabilities require less repeated setup;
- applications share canonical meaning and governed workflows;
- public experiences remain distinct while internal operations share authoritative records;
- performance, reliability and security improve through evidence;
- provider change does not redefine FIKA concepts;
- repeated manual work and copied configuration decline;
- new evidence can change the platform without losing history or traceability.

## Governance

See [documentation governance](docs/documentation-governance.md) and the [business-discovery process](docs/platform-methodology/business-discovery-process.md).
