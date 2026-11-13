# 2026-11-13 — Place master PDF action beside the allergen review date

Moved the existing master allergen PDF action from Production Week/Day to the CPU Allergen Checker filter bar. The action and unavailable/pending state name the full selected service date. Date changes hide old links immediately; mismatched-date responses remain unavailable. Availability refreshes when the current signed-release status changes. The existing server resolver, signatures, hash/access checks, generation, Drive configuration and review/signing workflows are unchanged.

Validation: tablet/desktop browser tests passed for signed/unsigned dates, delayed prior-date responses, wrong-date responses, year-end and UK DST boundaries, and removal of the Production Week duplicate. Focused server tests 6/6 and CPU typecheck passed. Full governed validation and exact-source CI are recorded in the PR.

Deployment: production authorised, pending protected-main CI and governed rollout verification. No operational data writes required.
