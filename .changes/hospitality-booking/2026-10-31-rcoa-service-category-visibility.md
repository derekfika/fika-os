# 2026-10-31 — Governed RCoA service category visibility

RCoA standard and All Day booking menus and server validation consume the published Hub layout by service and canonical site. Missing, malformed or unverified settings block new bookings. Saved incompatible selections remain visible with explicit removal and keyboard focus instead of silently disappearing. Confirmed existing submissions replay through an authenticated no-create path; missing children are validated before any new group booking.

Validation: focused visibility/API tests 8 passed; keyboard regression and targeted site-branding tests passed (13/13). The governed affected run reached Hospitality and reported 433/434 tests: its sole failure was a stale source assertion for the submit button's disabled condition. The assertion was updated to include the governed visibility-loading guard and its test file passes. Full governed validation/builds remain pending; typecheck passed before this assertion-only edit. No staging write-path UAT while #181 isolation is unverified. CFC/Munich RE integration remains separate, including #119 mapping/form and #199 dependencies.
Deployment: none.
