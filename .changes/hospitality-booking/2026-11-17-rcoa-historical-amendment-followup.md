# 2026-11-17 — Save historical RCoA commercial corrections

Hospitality amendments of historical RCoA bookings now save quantities for originally ordered lines even when their catalogue Offering is no longer active. The Hub retains their agreed prices and prices newly added items from the event-date catalogue record. Historical edits retain the original date, service identity, quote history and operational records.

Validation: Hub RCoA focused tests, standalone and grouped amendment emulator coverage, AUTHMOD denial/grant emulator test, past-date new-booking emulator regression, and Hospitality typecheck/build passed. The Hub full suite had 1 unrelated missing-submodule fixture failure (1,094 passed, 125 skipped).

Deployment: Hospitality staging remains on PR #572 rollout `build-2026-11-17-002`; this follow-up changes Hub only. Standalone and All Day group past-event edits saved and reopened through the Hospitality custom domain using a staging RCoA-authorized session. The group correction retained the 5 November 2026 event date, service times and location, preserved quote revision 1, and generated a saved revision 2 PDF. No CPU handoff was sent. Actor UID is present in the audit; Isaias's personal staging acceptance remains outstanding. Production was not deployed and no production data or permissions were changed.
