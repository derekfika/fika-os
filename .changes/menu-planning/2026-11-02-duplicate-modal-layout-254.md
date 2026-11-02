# 2026-11-02 — Usable Duplicate Planning modal layout (#254)

The Duplicate Planning dialog had no dedicated styling: inherited `.item-detail` label/input rules turned every radio and checkbox into a full-width grid row, producing long scrolling and misaligned inputs and actions on desktop. It is now a viewport-bound workspace dialog (1040px max, 16px safe gutters) with the form (From / To / What to copy) beside a sticky live preview at 980px and above, a single column below, a scrolling body and a pinned Cancel / Copy as draft footer. Choices are labelled 40px chips with native inputs and visible focus; destination weeks sit in a bounded grid. The preview-then-apply flow, replace confirmation and published-day protection notice are unchanged. UI only: no API or data change (stacked on the #254 functional fix).

Style Guide compliance: PASS (light surfaces, FIKA tokens, no new colours, text-labelled warnings).

Validation: `npm test` and `tsc --noEmit` in apps/menu-planning; new layout contract test; static-harness check of the real stylesheet at 820/1024/1280/1536px showed no horizontal overflow. Not run: Playwright against the live app or staging.
Deployment: none.
