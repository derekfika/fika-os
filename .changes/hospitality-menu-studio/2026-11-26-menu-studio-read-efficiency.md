# 2026-11-26 — Reduce Menu Studio catalogue and dish reads

Menu Builder, the sidebar and preview selectors share a verified Hospitality catalogue. Builder startup uses the first draft-summary response to check the package manifest. The browser keeps only the public-safe package in IndexedDB. Studio reuses verified gzip bytes after Hub checks the caller's catalogue access. The commercial catalogue stays in session-scoped memory and checks Hub's version before reloading. Confirmed edits update the affected rows and recheck the public projection.

Opening Builder no longer loads the legacy menu list or Dish Library. Dish browsing shares one paginated library, and assigned revision requests reuse exact immutable revisions. Read traces identify the Studio Firestore, Hub and package paths without storing telemetry in Firestore.

Validation: Studio typecheck and all 118 unit tests passed, including cold and warm loads, simultaneous requests, invalid packages, revalidation, session expiry and revision reuse.
Deployment: none.
