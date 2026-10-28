# 2026-10-28 — P0 publication includes zero-allocation canonical references

Fixes #111: hosted publication fetched canonical dishes only for positive allocations, then validated all named rows against that incomplete set. Existing zero-allocation dishes were falsely reported missing/archived. Resolve all named references by stable ID; preserve canonical validation and the separate positive-allocation filter for published production entries. No working menu, dish, portion or allergen data is changed.

Validation: read-only production inspection found all 87 referenced canonical records for 109 named entries; the baseline lookup excluded precisely four reported dishes. Pure local reproduction over backed-up records yielded the exact production errors with the old subset and none with the complete set. Focused/full tests, isolated hosted-path Firestore publication regression, typecheck/build and exact-source CI are recorded in the hotfix PR/incident.
Deployment: emergency Menu Planning release tracked in incident #111; no production data repair or allergen inference is required. Success requires actual publication and downstream CPU/Delivered-In verification, not CI alone.
