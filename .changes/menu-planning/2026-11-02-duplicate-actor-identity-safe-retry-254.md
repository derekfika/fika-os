# 2026-11-02 — Duplicate Planning actor identity and safe partial retry (#254)

Root cause: the Hub `/api/menu-planning/access` contract returns the authenticated identity as
`principal.id`, but Menu Planning read `principal.identityId`, so `MenuActor.uid` was undefined for
every real session. Duplicate Planning wrote that undefined actor into `audit[].by`, which Firestore
rejects ("Cannot use undefined as a Firestore value (found in field audit.1.by)"). Other routes were
silently masked by a `"local-menu-planner"` default parameter. `ignoreUndefinedProperties` is not
enabled and no identity is hardcoded.

Changes: `resolveMenuActor` now reads `principal.id` (legacy `identityId` accepted) and fails closed
(401) when no non-empty identity exists. `duplicateMenuPlanning` and `planMenuDuplicate` require a
verified actor before any read or write, and the command refuses (409, zero writes) if any week it is
about to save already contains an audit element with no actor, reporting the path without repairing or
attributing it. Multi-week apply stays sequential, but a retry with the same operation ID now skips
destinations already carrying that operation's audit marker (no version/hash conflict, no rewrite),
verifies the remaining destinations by per-destination digests returned from the preview, and never
overwrites published days.

Validation: `npm test` (menu-planning), `tsc --noEmit`; new regressions for missing/empty actor,
actor-less audit element, multi-destination apply, retry after partial apply, published-day protection.
Deployment: none. No live data was read or changed; any existing "local-menu-planner" attributions
from earlier writes are left as historical evidence.
