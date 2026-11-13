# 2026-11-13 — Cache CI npm downloads by lockfiles

Enabled setup-node npm caching for all affected application jobs and the Hub emulator job, keyed by root and selected application lockfiles. For Hub, separated unit tests from the exact-source build/typecheck lane and runs typecheck with the build concurrently. Other applications retain their current combined validation lane. `npm ci`, exact-source validation and all required merge gates remain in place.

Validation: exact-source PR run 43505231652 passed. It completed the full merge gate in 124s versus the 10-run median of 283s for comparable complete baseline runs (56% reduction). npm caches restored successfully; Hub emulator job completed in 101s. No checks or gates were removed. Deployment: none.
