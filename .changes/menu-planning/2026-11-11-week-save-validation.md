# 2026-11-11 — Make Week Planner save validation actionable

Week draft saves now accept the governed and one-off destination snapshots already supported by rolling entries. Rejected saves return sanitized field paths and row context for Week Planner, and confirmed 4xx rejections release the pinned retry request while retaining the browser draft. No week, publication or catalogue data is changed by this fix.

Complexity: High. Recommended model: Sol. Reason: operational production save correctness and preservation of user-authored draft data.

Validation: Menu Planning tests 551 total (547 passed, 4 skipped), typecheck, production build, and governed `fika validate` passed. Deployment: staging and production rollouts pending governed release.
