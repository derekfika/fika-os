# FIKA OS - Workflow Evolution and Build Narrative

## Document status

Purpose: this document reconstructs the evolution of the FIKA OS governance, review, schema and delivery workflow from Stage 1 foundations to the current pack-based export and schema-production method.

Scope: this is an institutional-memory document. It records evidenced workflow improvements, governance innovations, process failures and corrections, maturity signals, lessons learned and future evidence to capture. It is not a marketing document, an award submission, a repository integration plan or an implementation plan.

Evidence base: the reconstruction uses the local working materials available in this workspace, including `fika-platform-specs/docs/stage-1-review.md`, `fika-platform-specs/docs/engineering/ai-development-playbook.md`, `fika-platform-specs/docs/schema-reviews/pack-1-schema-design-report.md`, `fika-platform-specs/docs/schema-reviews/pack-1-bdr-to-schema-traceability.md`, `fika-platform-specs/schemas/pack-1/`, `fika-platform-specs/fixtures/pack-1/`, `.codex-staging/pack-2-revision-2/02 Pack 2/Pack 2 Revision 2 Markdown/pack-2-revision-2-validation-report.md`, `.codex-staging/pack-2-schema-draft/02 Pack 2/Pack 2 Schema Draft/reports/schema-design-report.md`, `.codex-staging/pack-2-schema-draft/02 Pack 2/Pack 2 Schema Draft/reports/validation-report.json`, `.codex-staging/pack-3-approved-export-schema/03 Pack 3/Pack 3 Approved Export and Schema Draft/reports/final-pack-readiness-report.md`, `.codex-staging/pack-3-approved-export-schema/03 Pack 3/Pack 3 Approved Export and Schema Draft/reports/schema-design-report.md`, and the supplied workflow prompts preserved in this conversation context.

Current reconstruction date: 14 July 2026.

Status: living retrospective. Factual claims should be updated only when supported by additional evidence. Where exact early dates or motivations are not proven by the available materials, the document says so explicitly.

## Executive summary

The FIKA OS workflow began as an evidence-gathering and architecture-foundation exercise. Stage 1 established scope, inventories, current-system maps, platform principles, target architecture and early draft domain models, while also identifying major risks: premature consolidation, projections becoming authority, schema overreach, unresolved amendment semantics, legacy dependency, storage coupling and security gaps (`fika-platform-specs/docs/stage-1-review.md`).

The method then evolved from broad repository interrogation into a governed sequence: business discovery, human-approved canonical Decisions, Business Decision Records, pack review, governed registers, frozen ZIP snapshots, staged Markdown export, schema production, validation, traceability and separate repository integration. The central innovation was not that AI drafted documents or schemas; it was that human business authority and AI-assisted execution were separated and controlled. The AI could analyse, draft, stage, validate and report, but it did not create business authority or silently rewrite approved meaning (`fika-platform-specs/docs/engineering/ai-development-playbook.md`).

The value created was a repeatable way to move from messy operational knowledge into reviewable, traceable business contracts without collapsing discovery, governance, schema design, repository write-back and implementation into one risky activity. Later pack outputs show increasing control: Pack 1 produced 10 draft schemas with 11 valid and 7 invalid fixtures; Pack 2 produced 12 draft schemas with 12 valid and 12 invalid fixtures; Pack 3 combined governed Markdown export and schema production, producing 10 revised BDR candidates, 9 schemas, 9 valid fixtures, 9 invalid fixtures and a final readiness report with zero blocking validation failures (`fika-platform-specs/docs/schema-reviews/pack-1-schema-design-report.md`; `.codex-staging/pack-2-schema-draft/02 Pack 2/Pack 2 Schema Draft/reports/validation-report.json`; `.codex-staging/pack-3-approved-export-schema/03 Pack 3/Pack 3 Approved Export and Schema Draft/reports/final-pack-readiness-report.md`).

The current mature workflow matters because it gives FIKA a way to grow the platform without letting implementation convenience define business meaning. It also preserves a credible story of learning: controls were introduced because real weaknesses appeared.

## Timeline at a glance

| Stage or phase | Approximate date or sequence | Key activity | Problem discovered | Workflow improvement introduced | Resulting benefit | Evidence source |
|---|---|---|---|---|---|---|
| Stage 1 foundation | Before Stage 2; closed as Stage 1 | Current-system mapping, inventories, first architecture synthesis and draft booking model | Similar systems hid genuine business differences; spreadsheets and projections risked becoming authority | Evidence-first architecture documents and explicit Stage 1 closure criteria | Platform scope, risks and Stage 2 inputs became visible | `fika-platform-specs/docs/stage-1-review.md` |
| Stage 2 engineering standards | After Stage 1 closure | Engineering standards and AI working model | AI and implementation work could blur business authority, production authority and execution | AI Development Playbook separated ChatGPT, Codex and human responsibilities | AI became an assistant to governed work, not an authority source | `fika-platform-specs/docs/engineering/ai-development-playbook.md` |
| Stage 3 and Stage 4 business decisions | Sequence evidenced by Stage 1 review and BDR files | Business discovery and Business Decision Records | Business terms such as Client, Operational Location, Service and Role could be used inconsistently | Canonical BDR format with locked Decision sections | Business meaning could be reviewed and traced before schema or implementation | `fika-platform-specs/docs/business-decisions/`; `fika-platform-specs/docs/stage-1-review.md` |
| Pack 1 schema checkpoint | 13 July 2026 according to report | Pack 1 BDR-to-schema design for Client, OPLOC and Location Type | Accepted BDRs still needed a structured contract and review gate before adoption | Draft schemas, valid and invalid fixtures, traceability matrix and semantic validation | Schema review became a governed checkpoint, not implementation | `fika-platform-specs/docs/schema-reviews/pack-1-schema-design-report.md` |
| Pack 2 governed refactoring | Revision 2 sequence | Role, authority, configuration and capability BDRs refined against later Canon | Later Canon weakened or superseded earlier approved wording; CAP-004 approval status was initially not complete | Governed Refactoring Register and staged Markdown only | Retrospective correction became controlled instead of ad hoc | `.codex-staging/pack-2-revision-2/02 Pack 2/Pack 2 Revision 2 Markdown/pack-2-revision-2-validation-report.md` |
| Pack 2 schema draft | After Pack 2 governed refinement | Schema contracts for roles, responsibilities, assignments, AUTHMOD, capability and configuration concepts | Schema design needed to preserve Ownership, Authority, Assignment, Capability and Permission as separate concepts | ZIP-only schema draft with valid and invalid fixtures | Pack 2 governance became reusable schema evidence without repository write-back | `.codex-staging/pack-2-schema-draft/02 Pack 2/Pack 2 Schema Draft/reports/schema-design-report.md` |
| Pack 3 combined export and schema production | 14 July 2026 in supplied ZIP/report names | Governed Markdown export plus schema production for Service domain | Service Occurrence and Service Template terminology had been adopted too early or remained unresolved | Combined approved pack export, retitle of SVC-006, schema production and readiness reporting | One pack could move from approved decisions to staged docs and schemas in a reproducible run | `.codex-staging/pack-3-approved-export-schema/03 Pack 3/Pack 3 Approved Export and Schema Draft/reports/final-pack-readiness-report.md` |
| Current reflection checkpoint | Present document | Retrospective of workflow evolution | Method improvements risk being lost as tacit knowledge | Workflow evolution narrative and future evidence checklist | Organisational memory becomes reusable for training, governance and future storytelling | This document |

## Stage-by-stage evolution

## Stage 1 - Evidence-first platform foundations

### What we were trying to achieve

FIKA needed to understand the current application landscape, platform scope, architectural risks and first shared domain boundaries before changing production systems.

### How the workflow worked at that point

The work read existing repositories and documentation, created inventories, audited application families and drafted current and target architecture documents. Stage 1 produced a foundation rather than an implementation. The closure record says Stage 1 established a central architecture repository, scope boundaries, roadmap context, platform principles, application inventory, data-source and integration inventories, and detailed audits of hospitality dashboard, booking platform and CPU production workflows (`fika-platform-specs/docs/stage-1-review.md`).

### What problem or limitation became visible

Stage 1 exposed multiple architectural risks: premature consolidation, operational projections becoming authority, schema overreach, unresolved amendment semantics, identity duplication, legacy dependency, storage coupling and security gaps. It also recorded many remaining unknowns about owners, users, permissions, retention, performance, Events, Logistics, Workforce and configuration ownership (`fika-platform-specs/docs/stage-1-review.md`).

### Improvement or innovation introduced

The method separated evidence gathering from implementation. Stage 1 closure explicitly did not approve production refactoring, schema adoption, storage selection, deployment change or application consolidation.

### Why the change mattered

This prevented early architecture work from becoming accidental production authority. It also made TODOs and unknowns acceptable outputs rather than gaps to be guessed.

### Evidence

`fika-platform-specs/docs/stage-1-review.md`.

### Lasting effect on the current method

Every later pack retained the principle that evidence, decisions, schemas, repository integration and implementation are separate gates.

## Stage 2 - AI-assisted development discipline

### What we were trying to achieve

FIKA needed a repeatable way for ChatGPT and Codex to assist without inventing business facts, broadening scope or mutating production systems.

### How the workflow worked at that point

The AI Development Playbook assigned ChatGPT to collaborative reasoning and Codex to workspace execution, evidence inventory, scoped changes, validation and traceable artefacts. It stated that human owners approve business meaning, risk, permissions, production actions, schema adoption and releases (`fika-platform-specs/docs/engineering/ai-development-playbook.md`).

### What problem or limitation became visible

AI could easily appear authoritative if it drafted plausible decisions, schemas or implementation plans. Without explicit boundaries, analysis, design, repository edits and production actions could collapse into one flow.

### Improvement or innovation introduced

The playbook established stop conditions, handoff templates, validation expectations and the principle that AI supports reasoning and execution but does not supply missing business facts or independent authority.

### Why the change mattered

It made AI useful precisely because it was constrained. Codex could run repeatable checks and produce staged artefacts, while Derek and business reviewers retained business authority.

### Evidence

`fika-platform-specs/docs/engineering/ai-development-playbook.md`.

### Lasting effect on the current method

Current pack prompts explicitly prohibit repository write-back, commits, pushes, deployments and silent reinterpretation unless separately authorised.

## Stage 3 and Stage 4 - Business discovery and BDR formation

### What we were trying to achieve

The goal was to turn discovered operational knowledge into canonical business Decisions before schemas and implementation.

### How the workflow worked at that point

Business Decision Records were created for domains such as Client, Operational Location, Location Type, Role, Capability, Configuration and Service. The available BDR files include metadata, context, locked Decision sections, rationale, consequences, trade-offs, implementation implications, related decisions and evidence (`fika-platform-specs/docs/business-decisions/`).

### What problem or limitation became visible

Early discovery terms could be adopted prematurely. Named individuals could appear as canonical owners. Job titles could imply authority. Business Meaning, Configuration, Operational Capability and Permission could be conflated.

### Improvement or innovation introduced

BDRs introduced locked canonical Decision sections and a durable evidence trail. Later Review Doctrine and Authority Model work introduced sharper separations such as Ownership != Authority != Assignment != Technical Administration.

### Why the change mattered

It gave schemas and future implementation a governed source of meaning. It also made it possible to amend or supersede earlier decisions without erasing history.

### Evidence

`fika-platform-specs/docs/business-decisions/`; Pack 2 validation report; Pack 3 final readiness report.

### Lasting effect on the current method

Schemas now trace to BDR IDs, and schema reports state that drafts are not adopted until human review.

## Pack 1 - First schema checkpoint from frozen business meaning

### What we were trying to achieve

Pack 1 attempted to convert accepted and frozen BDRs for Client, Client Contact, Operational Location and Location Type into storage-independent draft schemas for human review.

### How the workflow worked at that point

The Pack 1 schema report states that ten Draft 2020-12 schemas were created, with eleven valid fixtures and seven deliberately invalid fixtures. It also states that Pack 1 BDRs remained Accepted and Frozen and that schema work did not change business meaning (`fika-platform-specs/docs/schema-reviews/pack-1-schema-design-report.md`).

### What problem or limitation became visible

Schema design exposed unresolved adoption blockers such as lifecycle catalogues, address ownership, actor and provenance references, relationship classification, personal-data privacy and duplicate/merge evidence.

### Improvement or innovation introduced

The workflow added BDR-to-schema traceability and valid/invalid fixture validation. It used `additionalProperties: false` to prevent implementation, provider or generic CRM fields from entering the canonical draft without traceability.

### Why the change mattered

It proved that schema generation could strengthen governance rather than bypass it. Invalid fixtures made governed boundaries testable.

### Evidence

`fika-platform-specs/docs/schema-reviews/pack-1-schema-design-report.md`; `fika-platform-specs/docs/schema-reviews/pack-1-bdr-to-schema-traceability.md`; `fika-platform-specs/schemas/pack-1/`; `fika-platform-specs/fixtures/pack-1/`.

### Lasting effect on the current method

Every later schema pack included valid fixtures, invalid fixtures, traceability and a validation report.

## Pack 2 - Governed refactoring rather than silent correction

### What we were trying to achieve

Pack 2 had to align previously reviewed Role, Configuration and Capability decisions with later approved Canon and Review Doctrine.

### How the workflow worked at that point

The Pack 2 Revision 2 validation report states that thirteen approved GRR amendments were staged, one GRR entry was not staged because it was awaiting approval, and no repository write-back was authorised. It also records zero validation errors, eighty-eight warnings, exact Decision text matching, required metadata checks, heading checks and candidate diff checks (`.codex-staging/pack-2-revision-2/02 Pack 2/Pack 2 Revision 2 Markdown/pack-2-revision-2-validation-report.md`).

### What problem or limitation became visible

Approved early decisions had been weakened by later Canon. Some wording embedded named individuals or job-title authority. A pending approval gate around CAP-004 showed that not every useful amendment was automatically authorised.

### Improvement or innovation introduced

The Governed Refactoring Register distinguished retrospective alignment from ordinary decision creation. It allowed approved replacement wording to be applied exactly while preserving unapproved items as blockers.

### Why the change mattered

It made correction auditable. The process did not pretend that the first approved wording was perfect, but it also did not allow Codex to rewrite business meaning informally.

### Evidence

`.codex-staging/pack-2-revision-2/02 Pack 2/Pack 2 Revision 2 Markdown/pack-2-revision-2-validation-report.md`.

### Lasting effect on the current method

Current prompts distinguish GDR for governed decisions from GRR for governed refactoring, and require exact-decision-text validation.

## Pack 2 - Schema draft from ZIP authority

### What we were trying to achieve

After governed Pack 2 refinement, the next aim was to generate technology-neutral schema contracts for organisational roles, responsibilities, assignments, authority grants, permission vocabulary, access, emergency access, capabilities, enablement, dependency rules and overrides.

### How the workflow worked at that point

The Pack 2 schema design report states that the schemas were draft business schemas generated from the authorised ZIP snapshot only, not adopted schemas, database designs, APIs or implementation models. The validation report shows twelve valid fixtures passed and twelve invalid fixtures failed as expected, with zero failures (`.codex-staging/pack-2-schema-draft/02 Pack 2/Pack 2 Schema Draft/reports/schema-design-report.md`; `.codex-staging/pack-2-schema-draft/02 Pack 2/Pack 2 Schema Draft/reports/validation-report.json`).

### What problem or limitation became visible

Schema generation needed to preserve governance separations rather than encode convenience. The report deliberately excluded database tables, collections, APIs, provider IDs, application roles, production details and named individuals as enduring business owners.

### Improvement or innovation introduced

The ZIP became the authorised run boundary. Schema generation no longer consulted the repository, Drive or previous sessions. It produced a staged manifest, schemas, fixtures, traceability and validation reports.

### Why the change mattered

This reduced source-of-truth drift and token waste. A future reviewer could rerun or inspect the pack without guessing which source was authoritative.

### Evidence

`.codex-staging/pack-2-schema-draft/02 Pack 2/Pack 2 Schema Draft/reports/schema-design-report.md`; `.codex-staging/pack-2-schema-draft/02 Pack 2/Pack 2 Schema Draft/reports/validation-report.json`.

### Lasting effect on the current method

Later prompts explicitly state that the ZIP is the only authorised working source and that repository write-back is a separate action.

## Pack 3 - Combined approved export and schema production

### What we were trying to achieve

Pack 3 combined governed Markdown export and schema production for the Service domain from one fully approved pack snapshot.

### How the workflow worked at that point

The Pack 3 final readiness report states that the ZIP was treated as the sole source, repository write-back was not authorised, ten BDRs were reviewed, nine decision amendments or replacements plus one no-amendment export were applied, SVC-006 was retitled to Scheduled Work and Booking Boundary, nine schemas were generated, nine valid fixtures passed, nine invalid fixtures failed as expected and zero schema validation failures remained (`.codex-staging/pack-3-approved-export-schema/03 Pack 3/Pack 3 Approved Export and Schema Draft/reports/final-pack-readiness-report.md`).

### What problem or limitation became visible

Service Occurrence and Service Template terminology had been adopted before their business value was proven or confirmed. Pack 3 also showed a runtime limitation: no full external Draft 2020-12 validator was available, so local structural validation was used and labelled as such.

### Improvement or innovation introduced

The workflow combined Markdown export, schema production, traceability, warnings, validation and readiness reporting in one reproducible staged output. It also classified findings as errors, warnings and informational observations.

### Why the change mattered

The pack became reviewable before repository integration. The process preserved exact canonical wording even when it retained a negative reference to a retired term, while removing retired terminology from non-canonical explanatory text.

### Evidence

`.codex-staging/pack-3-approved-export-schema/03 Pack 3/Pack 3 Approved Export and Schema Draft/reports/final-pack-readiness-report.md`; `.codex-staging/pack-3-approved-export-schema/03 Pack 3/Pack 3 Approved Export and Schema Draft/reports/schema-design-report.md`.

### Lasting effect on the current method

The current mature method can process a fully approved pack into staged Markdown and staged schemas without modifying the repository.

## Workflow innovations register

| Innovation | First evidenced appearance | Problem solved | Rule introduced | Operational benefit | Governance benefit | Repeatability value | Related evidence |
|---|---|---|---|---|---|---|---|
| Evidence-first Stage 1 closure | Stage 1 review | Architecture work could imply implementation approval | Stage closure did not approve refactoring, schema adoption or deployment | Reduced operational risk | Unknowns became Stage 2 inputs | Can close discovery without pretending all facts are known | `docs/stage-1-review.md` |
| Human authority versus AI execution | AI Development Playbook | AI could appear to approve business meaning | Human owners approve meaning, risk, permissions, schema adoption and releases | AI can execute safely | Business authority remains human | Reusable handoff and stop conditions | `docs/engineering/ai-development-playbook.md` |
| Locked canonical Decision sections | BDR format | Explanatory text could drift into decision text | Decision section is canonical and locked | Review focuses on the authoritative wording | Protects approved meaning | Later validation can compare exact text | `docs/business-decisions/` |
| BDR-to-schema traceability | Pack 1 schema report | Schemas could include fields without authority | Major fields and relationships trace to BDRs | Easier schema review | Prevents implementation fields from entering unnoticed | Repeatable per pack | `docs/schema-reviews/pack-1-bdr-to-schema-traceability.md` |
| Valid and invalid fixtures | Pack 1 schema report | Boundaries were hard to test from prose alone | Include passing and failing examples | Makes rules executable | Demonstrates protected meaning | Reused in Pack 2 and Pack 3 | Pack 1, Pack 2 and Pack 3 validation reports |
| Accepted and Frozen pack status | Pack 1 schema report | Downstream schemas needed stable authority without claiming immutability | Frozen means current canonical authority, not immutable forever | Enables schema dependency | Requires future amendment or superseding BDR | Reusable freeze concept | `docs/schema-reviews/pack-1-schema-design-report.md` |
| Governed Refactoring Register | Pack 2 Revision 2 | Later Canon weakened earlier wording | Apply only approved refactoring entries exactly | Prevents ad hoc correction | Keeps history and authority intact | Reusable for retrospective alignment | Pack 2 validation report |
| GDR versus GRR distinction | Pack 2/Pack 3 pack reports | New decisions and retrospective refactors could be confused | GDR governs pack decisions; GRR governs approved refactoring | Clearer processing route | Avoids false authority | Repeatable pack processing | Pack 2 and Pack 3 reports |
| Immutable ZIP run boundary | Pack 2 schema draft | Repository, Drive and local drift could compete | ZIP is sole authorised source for that run | Reduces scanning and ambiguity | Creates reproducible evidence package | Makes runs auditable | Pack 2 schema design report; Pack 3 prompt/report |
| Staged output before repository integration | Pack 2 and Pack 3 reports | Repository write-back could happen before review | Staged files first; integration separately authorised | Safer review cycle | Maintains repository gate | Repeatable no-write runs | Pack 2 and Pack 3 reports |
| Exact-decision-text validation | Pack 2 validation report | AI might paraphrase approved wording | Decision text must match approved wording character-for-character | Reduces review ambiguity | Protects canonical language | Enables mechanical validation | Pack 2 validation report |
| Error/warning/information classification | Pack 3 final report | Missing links or validator limits could be mistaken for blockers | Classify findings by severity | Clearer readiness decisions | Prevents warnings becoming silent failures | Reusable final report pattern | Pack 3 final readiness report |
| Full validator limitation disclosure | Pack 2 and Pack 3 schema reports | Validation could be overstated | State when only local structural validation is available | Honest technical risk reporting | Avoids false assurance | Repeatable runtime disclosure | Pack 2 and Pack 3 validation reports |
| Post-schema reflection checkpoint | Present document | Workflow lessons risk being lost | Record what schemas exposed and what changed | Better future pack design | Preserves institutional learning | Template for every pack | This document |

## Problems, near misses and corrections

| Problem or near miss | What happened | Why it mattered | Correction | Permanent control |
|---|---|---|---|---|
| Competing sources of truth | Stage and pack work could draw from repository files, Drive exports, local staging and previous sessions | A schema or BDR could be based on the wrong authority | Frozen ZIP snapshots became the run boundary for pack processing | Prompts now say ZIP is the sole authorised source |
| Repository write-back risk | Early workflows could create or refine docs while the repository was dirty | Review output could be mixed with unrelated changes | Staged output folders were used and reports confirmed no repository write-back | Repository integration is a separate authorised stage |
| Projection becoming authority | Stage 1 found Sheets, dashboards, calendars and adapters could reconstruct or compete with canonical records | Operational projections could define business meaning accidentally | Architecture separated canonical records, operational projections and legacy adapters | Later schemas avoided provider-specific implementation fields |
| Named individuals embedded as ownership | ROLE-001 and SVC-010 evidence show earlier decisions named Derek, Sam or Brian | Canonical ownership would depend on current postholders | AUTHMOD and role-based wording replaced named-person authority where governed | Ownership, authority, assignment and administration are separate |
| Job titles implying authority | Pack 2 GRR identified Site Manager or broad function wording as authority shortcuts | Job titles could grant permissions without governance | AUTHMOD role/scope/action/effective-period grants were introduced | Authority grants are explicit and auditable |
| Terminology drift | Service, Service Arrangement, Recurring Schedule and Service Occurrence were blurred in Pack 3 source material | Premature terms could become schema names | SVC-006 was retitled and Service Occurrence was removed from the Pack 3 vocabulary except where preserved in exact approved Decision wording | Unresolved terminology remains deferred |
| Approved decisions weakened by later Canon | Pack 2 required retrospective alignment | Earlier approved wording could become inconsistent with later authority model | GRR captured approved amendments and replacements | Refactoring is governed rather than silent |
| Link validation in ZIP snapshots | Pack 2 and Pack 3 reports show many links to documents outside the snapshot | Missing links could be mistaken for content errors | Missing external links were classified as warnings | ZIP-local validation does not fail solely on external links |
| Runtime validator limitation | Pack 2 and Pack 3 did not have a full external Draft 2020-12 validator available | Overclaiming validation would weaken trust | Local structural validation was used and labelled | Validator limitations appear in readiness reports |
| Token and scanning waste | Inference from repeated prompt evolution: broad rescans were replaced by ZIP-only run boundaries | Broad context gathering increases cost and drift | Pack prompts instructed Codex not to search Drive, history or newer repo versions | Prompt plus ZIP became a reproducible boundary |

## Current operating model

The current mature operating model is:

Business discovery -> human-approved canonical Decisions -> governed pack review -> approved GDR or GRR -> frozen ZIP snapshot -> governed Markdown export -> schema production -> validation and traceability -> reflection checkpoint -> separate repository integration -> implementation.

Business discovery captures questions, terms, evidence, ambiguity and candidate answers. It does not itself authorise implementation.

Human-approved canonical Decisions establish business meaning. Derek and business reviewers approve the meaning; Codex does not.

Governed pack review groups related decisions into a reviewable unit. The pack can contain BDRs, Canon, review artefacts and a GDR or GRR.

An approved GDR records new or amended decisions for a pack. A GRR records retrospective refactoring needed to align earlier decisions with later Canon. They are related but not interchangeable.

A frozen ZIP snapshot sets the run boundary. It prevents repository, Drive and prior-session drift during export and schema production.

Governed Markdown export creates revised BDR candidates, applies approved amendments exactly, updates titles and filenames where approved, and produces a unified diff and validation report.

Schema production starts only after the Markdown candidates pass validation. Schemas are technology-neutral, storage-independent and traceable to BDRs. Valid and invalid fixtures test governed rules.

Validation and traceability classify errors, warnings and information. Warnings such as external links or missing full validators are not hidden.

The reflection checkpoint records what the pack clarified, what the schemas exposed and what should improve next time.

Repository integration is separate and requires explicit authority. Implementation comes after approved business meaning and schema review.

## Human and AI responsibility boundary

Derek and business reviewers approve business meaning, authority, risk, schema adoption, repository write-back and production action.

AI may analyse evidence, draft candidate wording, generate staged Markdown, produce schemas, run validation, compare exact text and prepare reports.

Codex does not create business authority. It does not silently rewrite Canon. It does not treat repository access as permission to write. It does not collapse schema production into implementation.

The standing separations are:

- Ownership != Authority != Assignment != Technical Administration.
- Business Meaning != Configuration != Capability != Permission.
- Domain != Operational Capability != Service != Service Arrangement.
- Approval != Publication.
- Planned Work != Requested Work != Completed Work.

These separations are not decorative. They are controls that prevent applications, schemas, providers or AI-generated convenience from redefining the business.

## Evidence of maturity

- Stage 1 closed with a named set of established artefacts and a named set of remaining unknowns, rather than claiming completion of all facts (`docs/stage-1-review.md`).
- Pack 1 created 10 Draft 2020-12 schemas, 11 valid fixtures and 7 invalid fixtures, with validation passed on 13 July 2026 (`docs/schema-reviews/pack-1-schema-design-report.md`).
- Pack 2 Revision 2 staged 13 approved GRR amendments, held back 1 not-ready item, recorded 0 validation errors and 88 warnings, and confirmed no repository write-back (`pack-2-revision-2-validation-report.md`).
- Pack 2 schema draft generated 12 schema contracts, 12 valid fixtures and 12 invalid fixtures with 0 validation failures (`Pack 2 Schema Draft/reports/validation-report.json`).
- Pack 3 reviewed 10 BDRs, applied 9 amendments/replacements plus 1 no-amendment export, generated 9 schemas, passed 9 valid fixtures, failed 9 invalid fixtures as expected and recorded 0 schema validation failures (`Pack 3 final-pack-readiness-report.md`).
- Pack 3 readiness explicitly classified missing external links, validator limitations and unresolved terminology as warnings rather than errors (`Pack 3 final-pack-readiness-report.md`).
- The workflow now produces staged-file manifests, unified diffs, validation reports, schema traceability and readiness reports before repository integration.

## Lessons learned

### Business discovery

Ask for business meaning before asking for implementation shape. Early ambiguity around Client, Operational Location, Service and Role showed that familiar words can hide several business concepts.

### Governance

Approved decisions can still need governed amendment later. The correct response is not silent editing; it is a GDR or GRR with exact wording, history and validation.

### AI-assisted working

AI becomes more useful when it is less authoritative. The strongest pattern is to let Codex do evidence processing, drafting, validation and staging, while humans approve business meaning.

### Source-of-truth management

Frozen ZIP snapshots are powerful because they reduce drift. They also create honest warnings when links point outside the snapshot.

### Schema design

Schemas are a review checkpoint, not a database design. Valid and invalid fixtures expose weak boundaries faster than prose alone.

### Repository integration

Repository write-back should be a separate, explicit step. This protects the repository from staged thinking and protects staged thinking from unrelated working-tree changes.

### Change control

Retire terminology deliberately. Pack 3 showed that removing a term such as Service Occurrence requires title updates, related-decision references, schema names and explanatory text to move together.

### Storytelling and organisational memory

The credible story is not that the workflow was perfect from the start. It is that the team noticed drift, ambiguity and overreach, then added controls that made the next run safer.

## Innovation narrative

The original operational problem was not only that FIKA had several systems. It was that business knowledge was distributed across applications, spreadsheets, workflows, provider artefacts and individual understanding. Stage 1 showed that similar code did not always mean identical business rules, and that projections such as Sheets, calendars and dashboards could become confused with authority.

The key insight was that software should not be allowed to define business meaning by accident. Before FIKA OS could become an implementation programme, it needed a governed language for Clients, Operational Locations, Roles, Capabilities, Services, Schedules, Bookings and related concepts.

The method that emerged is human-governed and AI-assisted. Derek and business reviewers approve canonical Decisions. Codex analyses evidence, drafts candidates, applies approved registers, generates schemas, validates fixtures and stages outputs. The AI is useful because it is bounded: it cannot approve meaning, silently rewrite Canon, push to the repository or deploy.

The workflow reduced drift by introducing frozen ZIP run boundaries, exact-decision-text validation, staged output folders, repository write-back gates, BDR-to-schema traceability and explicit error/warning classifications. It reduced rework by making unresolved concepts visible before they became schema or implementation commitments.

The method matters to FIKA because it turns operational learning into reusable organisational infrastructure. It supports growth by expressing business meaning once, governing it, testing it and then allowing applications to consume it.

This may later support an Innovation of the Year nomination, but the current evidence should be used as source material, not as a final award claim. Any future submission should add measured business impact, stakeholder feedback and implementation outcomes.

## Evidence gaps

1. Exact dates for the earliest repository interrogation and workbook creation are not proven by the materials reviewed here.
2. The full Business Knowledge Workbook and BDR Optimisation Workbook histories were not present in the local evidence set used for this document.
3. Google Docs review workflow details are known from supplied prompts and staged outputs but not fully reconstructed from original Docs metadata here.
4. Time savings, token savings and rework avoided are plausible benefits, but no measured figures were available in the reviewed evidence.
5. Stakeholder feedback and business impact after implementation are not yet evidenced.
6. The exact first appearance of Review Doctrine v2 and the Authority Model was inferred from Pack 2/3 reports and prompts, not reconstructed from a dated primary doctrine file in this pass.

## Future evidence to capture

- [ ] Date of each pack run.
- [ ] Pack name and pack number.
- [ ] Workflow used.
- [ ] Source package path or snapshot identifier.
- [ ] Problems encountered.
- [ ] Changes made to the workflow.
- [ ] Number and names of BDRs reviewed.
- [ ] Number and names of schemas generated.
- [ ] Valid fixture results.
- [ ] Invalid fixture results.
- [ ] Validation tool used and any validator limitation.
- [ ] Time or token savings where measurable.
- [ ] Examples of rework avoided.
- [ ] Business impact.
- [ ] Implementation impact.
- [ ] Stakeholder feedback.
- [ ] Screenshots or artefacts worth retaining.
- [ ] Nomination-ready evidence.

## Post-schema reflection template

### Pack

### Date

### What this pack clarified

### What surprised us

### What the schemas exposed

### Decisions that became stronger

### Workflow friction

### Workflow improvement introduced

### Risks avoided

### Evidence created

### What should change for the next pack

### Storytelling note

### Potential award evidence
