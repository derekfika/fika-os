# Hospitality universal notice — production release and UAT closure

## Production release

Integration Hub and Hospitality were released from the explicitly approved commit
`5ee6bdb4df3f05453ab000c6b17a6658decc3ad5`. Each serves
`build-2026-10-20-003`, READY/SUCCEEDED at 100% traffic. Hub was verified before
Hospitality deployment. This closure task did not redeploy or repeat completed
production checks; those results are the accepted prior release evidence.

Private/public catalogue v6 remained byte-identical, with no republication:

- Private: `e6fa618fb3fd5e8f5904e4a9afb901bbafe183122c6c73d86ae20ae737f10cdc`.
- Public: `b04d129c5b29a96f9c7234dfad1d146b0c55a549216996320ab5a8e2de42d71e`.

The previous release verified all five Node portals, universal empty-basket
restrictions, invalid-only authoritative rejection without matching downstream
work, and non-mutating standalone/group amendment calendar inspection. Refer to
the existing universal-booking-notice and booking-cutoffs handoffs for controlled
noon/DST regression evidence. No CPU or Logistics release is required.

## Remaining acceptance checks

| Check | Result | Evidence / next action |
|---|---|---|
| Genuine mobile viewport | PASS | Measured 375 × 844 CSS-pixel content viewport; 390 × 844 while the sheet removes the page scrollbar. |
| Mobile details layout | PASS | First seven Angel Court inputs each occupy one full-width row at x=18px, approximately 339px wide. Document scroll width equals client width. |
| Mobile date picker | PASS | Bottom sheet reaches y=844, starts near y=475, Close remains visible, unavailable-date reasons are readable, and no sheet-content scrolling is needed at this tested height. Close and two-stage Escape return focus to the date button. |
| RCoA single / All Day | PASS for inspected mobile sheets | Independently measured mobile viewport and bottom-sheet bounds; inspected without submitting a booking. Synthetic local draft cleared. |
| No clipped mobile content | FAIL | Angel Court hero heading text scroll width 473px exceeds its 327px box; screenshot shows clipping at the right edge. Source surface: `apps/hospitality-booking/app/ui/BookingPortal.tsx`, hero heading. Requires a separately approved presentation-only correction and mobile recheck. |
| Isolated authenticated cold cache | BLOCKED / not executed | Connected browser exposes only shared in-app tabs, with visibility/viewport capabilities. No documented isolated profile/context creation control is available. New tabs restore existing drafts and cannot prove isolation. |

Style Guide compliance: **DEVIATION** — confirmed mobile heading clipping. No
application source was modified to correct it in this task.

The isolated-cache operator must establish a genuinely empty browser context
(cookies, local/session storage, IndexedDB and service workers), authenticate
normally, and verify catalogue v6, new UI, successful fresh materialisation and
absence of stale-version/console errors without booking/order submission. Do not
clear the user's shared profile or copy credentials to manufacture this test.

External evidence is saved under:
`C:\Users\derek\Documents\FIKA OS Migration Evidence\Hospitality-UAT-Closure-2026-10-20`.
It includes measured dimensions, mobile screenshots and browser capabilities.

## Verdict and ownership

**Final UAT HOLD.** Production deployment remains live; no new backend defect or
reason to roll Hub back was identified. These are narrow remaining acceptance
items, not approval for another deployment or application change.

Canonical checkout: `main` at the approved SHA above. The prior uncommitted
CHANGELOG release-status entry is preserved. This task adds only a closure entry
and this documentation file; no commit or push. Preserve both documentation
changes when the next agent takes ownership. No application logic, production
configuration, catalogue, booking, notification, CPU or Logistics state changed.

Checkout ownership is released for Haiku's next authorised task. No message was
sent to another agent and no further development task was started.
