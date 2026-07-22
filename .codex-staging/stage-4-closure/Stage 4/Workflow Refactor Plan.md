# Workflow Refactor Plan

## Workflow doctrine

An active workflow remains stable throughout a stage.

Workflow improvements may be observed at any time.

Workflow improvements are considered only after stage completion unless failure would threaten Canon integrity or prevent completion.

This document records proposed improvements only. It does not modify the workflow.

## Proposals

| Identifier | Observation | Problem | Suggested improvement | Expected benefit | Priority | Apply in | Status |
|---|---|---|---|---|---|---|---|
| WRP-001 | Pack 3 initially lacked a Reflection until Pack Processing Standard v2.0 made it automatic. | Pack closure can appear complete while missing institutional learning. | Keep Reflection mandatory in all future pack-processing runs. | Ensures lessons and deferred concepts are preserved before archive. | High | Next pack-processing run | Accepted for next stage |
| WRP-002 | Pack 3 required a separate promotion step to canonical pack structure. | READY FOR ARCHIVE and READY FOR REPOSITORY INTEGRATION can be confused. | Preserve the separate Pack Promotion Standard and use explicit status language. | Prevents archive readiness from being mistaken for repository integration. | High | Next pack-promotion run | Accepted for next stage |
| WRP-003 | Full external Draft 2020-12 validation was unavailable during Pack 3 checks. | Validation confidence is limited if only local structural checks are available. | Add an approved full Draft 2020-12 validation tool to the standard workflow, or formally record the local validator as the accepted minimum. | Clearer assurance level and fewer repeated warnings. | High | Stage 5 | Proposed |
| WRP-004 | Pack 3 repository integration had to map canonical pack files manually into repository conventions. | Manual mapping creates avoidable placement risk. | Define a repository placement map for each pack artefact type before integration begins. | Faster integration and lower risk of duplicate artefacts. | Medium | Stage 5 | Proposed |
| WRP-005 | Mechanical link updates were required after approved BDR filename changes. | Retitles can leave stale links in indexes and dependent BDRs. | Add a retitle checklist covering BDR index entries, related decisions, schema traceability, and report warnings. | Fewer broken references and clearer audit reports. | High | Stage 5 | Accepted for next stage |
| WRP-006 | Repository `docs/stages/stage-4-business-decision-records.md` may still describe Stage 4 as active. | Stage-status documents can lag behind actual programme state. | Add a dedicated stage-status synchronisation workflow after closure approval. | Keeps repository roadmap/status evidence aligned with closed stages. | Medium | Stage 5 repository sync | Proposed |
| WRP-007 | Pack source ZIP, canonical pack folder and repository integration evidence can all exist at once. | Reviewers may not know which artefact is authoritative for which purpose. | Add a short authority note to future pack READMEs distinguishing source ZIP, canonical pack, repository integration report and repository copy. | Reduces source-of-truth confusion. | Medium | Next pack README template | Proposed |
| WRP-008 | Pack 3 archive certificate recorded repository integration pending while Pack README recorded READY FOR REPOSITORY INTEGRATION. | The status language is correct but easy to misread. | Standardise status definitions in a small glossary: READY FOR ARCHIVE, READY FOR REPOSITORY INTEGRATION, READY FOR HUMAN REVIEW, Accepted, Frozen. | Makes governance gates easier for humans to interpret. | Medium | Stage 5 | Proposed |
| WRP-009 | Pack validation reports preserve warnings, but not all warnings need action. | Warning volume can hide important items. | Add warning categories: informational, follow-up recommended, blocks future adoption, blocks repository integration. | Better prioritisation without suppressing evidence. | Medium | Stage 5 | Proposed |
| WRP-010 | The workflow evolution document records useful narrative but not measured impact. | Future storytelling or funding/award material lacks quantitative evidence. | Start capturing processing time, review time, rework avoided and validation counts per pack. | Creates evidence for operational improvement and programme value. | Low | Stage 5 onward | Proposed |
| WRP-011 | The Pack 3 promoted pack did not include a standalone fixture validation script. | Repository integration had to rely on preserved validation evidence rather than rerunning the same script. | Decide whether future canonical packs must include the validation script used for fixtures. | Improves reproducibility of repository integration checks. | Medium | Stage 5 | Proposed |
| WRP-012 | Some early workflow history and exact dates are incomplete. | Stage closure cannot fully reconstruct the historical path. | Maintain a lightweight run log for future packs and stages. | Better auditability and easier closure reports. | Medium | Stage 5 | Proposed |
| WRP-013 | The workflow has become sophisticated enough that prompts now act like operating standards. | Standards can drift if embedded only in conversation prompts. | Consider converting stable standards into governed methodology documents after the stage starts. | Makes repeatable workflow easier to train and review. | Medium | Stage 5 or later | Deferred |
| WRP-014 | Repository integration generated line-ending warnings on three Markdown files. | Repeated line-ending warnings may distract from substantive validation. | Decide whether to normalise line endings as a separate repository hygiene task. | Cleaner future diffs and less validation noise. | Low | Later repository hygiene workflow | Deferred |
| WRP-015 | Pack closure currently depends on the user stating the stage is complete. | Repository evidence may lag behind programme state. | Add a formal stage-closure authority note identifying who authorised closure and when. | Stronger provenance for future reviews. | Medium | Next stage closure | Proposed |

## Rejected proposals

None.
