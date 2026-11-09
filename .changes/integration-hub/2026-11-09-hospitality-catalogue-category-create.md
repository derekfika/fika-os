Date: 2026-11-09
Task: Hospitality Catalogue workflow — add category

Added a category-entry action to the company booking-service editor. New names stay in the local draft, reject case-insensitive duplicates and names over 160 characters, and use the existing scoped preview, reason, confirmation, optimistic-version save and audit command. Reworked Services and Locations to use a full-width editor with a responsive service selector, retaining compact tablet and mobile layouts. These changes do not create or alter production Items.

Validation: focused Hospitality catalogue services, UX and manager tests passed (21/21); Integration Hub typecheck and production build passed. Deployment: not performed.
