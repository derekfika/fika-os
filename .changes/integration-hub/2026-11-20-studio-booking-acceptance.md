# 2026-11-20 — Freeze Hub-verified Studio selections at Booking acceptance

The canonical Hub booking writer resolves the activated Studio menu for the exact site and service date. Preserve governed commercial validation and freeze accepted choices server-side before binding them to a quote. The pilot requires an explicitly scoped booking and a bound authorised operator. The existing Send to CPU path reads the frozen quote evidence.

Validation: 20 focused Hub unit and isolated Firestore tests, including a newer menu activation followed by the original booking's handoff and replay.
Deployment: none. The Hub booking pilot stays closed by default.
