# Branching and Release Standards

## Principles

Changes should be small, reviewable, reversible, attributable, and independently verifiable. Working production systems must not depend on an undocumented local state.

## Git workflow

- Maintain one protected default branch representing the reviewed releasable state.
- Create a short-lived branch for each coherent change. Suggested forms: `feature/<topic>`, `fix/<topic>`, `docs/<topic>`, `refactor/<topic>`, and `chore/<topic>`.
- Branch from an up-to-date default branch and keep the scope narrow.
- Do not combine unrelated formatting, refactoring, dependency, and behaviour changes.
- Reconcile divergence before review using the repository's documented policy. TODO: decide merge-versus-rebase preference.
- Delete merged short-lived branches when no longer needed.
- Emergency changes follow the same review and evidence requirements, with expedited approval and retrospective documentation.

## Commit conventions

Commit messages use an imperative summary and optional explanatory body:

```text
type(scope): concise outcome

Why the change is needed, important trade-offs, and migration notes.
```

Recommended types: `feat`, `fix`, `docs`, `refactor`, `test`, `perf`, `chore`, `build`, and `revert`.

- Each commit should represent one understandable step and leave the branch in a reviewable state.
- Explain why when the diff cannot.
- Reference the decision, issue, or business request where available.
- Never include secrets, private data, or sensitive production details in messages.
- Do not claim tests passed unless they were run.

## Pull request expectations

Every change intended for the default branch should receive review proportionate to risk. A pull request should include:

- outcome and business reason;
- files/capabilities affected;
- source-of-truth, schema, integration, permission, and migration impact;
- tests and checks run with results;
- manual verification evidence where relevant;
- screenshots for material UI changes, without private data;
- risks, failure modes and rollback approach;
- documentation/ADR changes;
- unresolved TODOs and follow-up work;
- confirmation that unrelated changes and secrets are absent.

Reviewers should examine behaviour, boundaries, recoverability, security, usability, tests, and documentation—not only syntax.

TODO: Confirm required reviewer count, code-owner rules, automated checks, and exception authority.

## Release readiness

Before release:

1. confirm intended scope and approved change;
2. verify the branch against current default;
3. complete the Definition of Done or document approved exceptions;
4. run automated, schema, regression and smoke checks that apply;
5. complete risk-based manual testing;
6. validate configuration and permissions without exposing values;
7. document data/schema migration, compatibility and rollback;
8. confirm monitoring, ownership and support window;
9. record the release version/change note.

## Release process

- Use versioned, reproducible release artefacts or an equivalent traceable release reference.
- Follow semantic versioning for shared contracts/packages where applicable: breaking, compatible feature, compatible fix.
- Separate deployment from feature activation when risk justifies a controlled rollout.
- Roll out gradually when the blast radius is material.
- Never run irreversible migration without backup, verification, ownership, and a rehearsed recovery plan.
- Verify the released capability with smoke tests and operational signals.
- Record result, time, actor, version, exceptions, and rollback if used.

TODO: Define repository-specific environments, release approval authority, maintenance windows, version tagging, and deployment tooling.

## Rollback and recovery

Every material release must state what can be rolled back, what data may have changed, how compatibility is preserved, and who decides. A code rollback is not sufficient if records, notifications, files, or external effects have changed.

If release verification fails:

- stop further rollout;
- preserve evidence;
- choose rollback, disablement, forward fix, or manual recovery based on the documented plan;
- communicate impact to the confirmed owner;
- record the outcome and required follow-up.

## Changelog guidance

Record user- or operator-relevant additions, fixes, behaviour changes, deprecations, migrations, and known limitations. Do not list internal noise. Link material architectural decisions and migration guidance.
