# 2026-10-29 — Shared van timeline lanes and PIN workflow links

Van 1 and Van 2 each occupy one timeline lane containing their own runs. Runs retain independent stable IDs, timing, assignment targets, stored stop order and inspector actions. Overlapping runs remain separately reachable with a text warning; untimed drafts keep explicit times-to-set controls. Selecting a different run resets its local action menu. Driver links now use the canonical van-specific PIN route while preserving run and service date; desktop AUTHMOD and server-side PIN authority are unchanged.

This delivers the van-row slice of #108/#120 and corrects a generated-link defect in #109. Older #20's remaining inspector/density proposals and production device acceptance remain separate. No production, fulfilment, allocation, permission or catalogue data changed. No new recurring reads, workers or audit writes.

Validation: governed validation passed all 80 workflow tests, 686 Logistics tests, typecheck and production build. All 83 distinct mounted browser scenarios passed across final runs (24/24 final boundary rerun; six optional capture cases skipped), including actual route/domain code on an isolated transactional store, assignment identity, ordering, retirement, retry/concurrency behavior, PIN-route links and desktop/zoom layouts. Exact-source CI results are recorded on the PR. Physical iPhone acceptance is still outstanding. Style Guide compliance: PASS (existing semantic tokens, light surfaces, keyboard selectors and text statuses).

Deployment: none; operational delivery issues remain open pending a governed release and live verification.
