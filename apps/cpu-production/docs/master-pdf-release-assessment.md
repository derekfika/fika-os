# CPU master PDF link — release assessment, 13 November 2026

The #530 per-order resolver returns site-derived PDFs for Menu orders. The new CPU-only date mode instead reads the existing completed master-review identity, exact active Menu order membership, every current dual-signed release, and their common master artifact. Existing all-site CPU authority, production Drive-owner resolution, bounded PDF/hash checks and post-download authority revalidation apply. No writes, generation, signatures, ACL/schema/auth or configuration changes.

`docs/deployment/workflow.md` explicitly makes staging and manual UAT optional. Staging Drive isolation is not a mandatory gate for this read-only production link. Exact merged-source CI, selected-backend authorization, production ancestry and serving verification still apply.

Serving CPU source is `571b701c093e501db68b086c69a7f4ca59095463`; task baseline main is `1bdc8402abe127e1706c6b7a8e7754bf76b6f8d6`. Current main inherits unreleased #521 Production Totals (RunSheetPrintDialog, kitchen-print, day-production-print, run-sheet-printing and page entry point), #530 per-order actions and #532 shared staging Drive provider changes. This task edits CPU only, but App Hosting deploys a complete eligible source commit and imported shared code. It cannot omit inherited app features automatically.

The owner prohibited bundling Totals and Drive infrastructure. Therefore this current-main candidate cannot be deployed under the present scope. The serving-to-candidate diff being informational in general policy does not authorize owner-excluded features. Do not deploy an unmerged PR head, bypass CI, or construct an unreviewed source overlay.

Minimum release decision: explicit owner acceptance of the exact inherited source delta, or an independently governed eligible source that excludes it while preserving main and accepted work. No temporary main rollback, feature removal or release-policy exception is authorized by this link task. This is a source-composition constraint, not another staging identity hold.

Live acceptance must use an existing current signed date master and verify exact review/release/date, hash, authorized all-site access, browser view/print and denied stale/unsigned/revoked cases. A healthy rollout alone is not acceptance. No production synthetic evidence or test writes.
