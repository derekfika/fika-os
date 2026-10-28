# Change entries

Each implementation PR adds one uniquely named Markdown file per affected app:
`.changes/<app-directory>/<date>-<workspace-or-change-id>.md`. App indexes link to
their fragment directory. Two agents use different filenames even for the same app.
Multi-app changes record each affected app. Shared-platform/architecture/OS tooling
changes use `.changes/platform/` or root `CHANGELOG.md`. Single-app work does not edit
root. Historical root entries remain intact; read-only and documentation-only tasks
need no entry. Markdown log changes do not trigger application builds.

Keep each entry human-readable and short:

```markdown
# 2026-10-28 — Short change title

Describe the problem and resulting behavior. State the affected domain/boundary.

Validation: actual tests/typechecks/builds and any remaining limits.
Deployment: none, or the verified app/environment/build.
```

Use `fika changelog check --base origin/main` to check the same rule as CI.
Changelog indexes and these uniquely named bookkeeping files are exempt from
implementation leases; source files remain subject to the full scope rules.
