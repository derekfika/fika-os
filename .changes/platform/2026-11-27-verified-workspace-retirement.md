# 2026-11-27 — Verified workspace retirement and artifact preservation

Allow owner-authorized retirement only for the two evidenced no-change checkouts, and preserve allowlisted ignored outputs from the explicitly merged candidate workspaces in integrity-checked recovery archives before governed cleanup. Unknown ignored files and unfinished work remain protected.

Validation: the full `source-workspaces.test.mjs` suite passed (27 tests); final targeted archive/verification-only regressions passed (5 tests). Protected exact-source CI is pending.
Deployment: none; workspace tooling only.
