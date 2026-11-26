# 2026-11-26 — Repair orphan bootstrap and cache retirement

Added a preview-first governed archival path for the exact three merged legacy
bootstrap records. It verifies the absent checkout and Git registration, task
owner and operation state, current remote branch head, matching merged PR head,
and merge ancestry on `origin/main`. Execution archives the original task
metadata with evidence and preserves remote branches; it does not fabricate
completion records or affect other bootstrap exceptions. Workspace retirement also
recognizes only the exact two CPython 3.14 print-agent bytecode files when their full
bytes reproduce from clean tracked source and the recorded timestamp, allowing safe
recovery of that retained checkout without broadening Python-cache cleanup.

Validation: the full `source-workspaces` and `workspace-cache` suites passed (31
tests); final focused rechecks for orphan allowlisting, lock-time metadata/operation
races, stale operation heads, and Python cache retirement passed (4 tests). The
changelog check and `git diff --check` passed. Exact-source CI remains required
before protected merge.
Deployment: none; tooling-only change.
