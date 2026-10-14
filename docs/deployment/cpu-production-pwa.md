# CPU Production PWA shell

Date: 2026-10-14. Scope: CPU Production only. Branch: `codex/cpu-production-pwa`.

Baseline: verified CPU staging revision `fika-cpu-production-staging-build-2026-10-14-003`, App Hosting build `build-2026-10-14-003`, source `5ef17b20927bd75234e4666194edfabf3a7de663`. This is the combined CPU staging/reuse lineage including the tablet responsive merge. The task branch starts at that exact commit; it does not incorporate the separate Hospitality provenance branch. Recorded fetched origin/main: `008bed112381b6a0072785dd2b72fae7bb438c14`.

## Installation contract

- Manifest: `https://cpu-staging.fikacatering.com/manifest.webmanifest`.
- Name: FIKA CPU Production. Short name: FIKA CPU.
- ID/start URL/scope: `/` on the dedicated CPU origin. Installed launch opens CPU directly; no launcher intermediary while the session is valid.
- Display: `standalone`. Orientation: `any`, allowing portrait and landscape. Browser layout, viewport zoom and existing tablet CSS remain intact.
- Theme: existing FIKA primary `#4f34c7`. Background: existing CPU page token `#f7f5f0`. Manifest/HTML metadata require literal colours; unit checks keep them aligned with existing CPU tokens.
- Existing `app/icon.svg` CPU FIKA monogram is rasterised to PNG at 192 and 512 pixels. Separate 512px maskable version places the same artwork within the safe area. A 180px Apple touch icon is also provided. No new artwork or unrelated branding.
- Regenerate the committed icons with `node scripts/generate-pwa-icons.mjs` from the CPU app, using the existing Next/Sharp installation.

Modern Chrome permits menu installation without a service worker: [Chrome install criteria](https://developer.chrome.com/blog/update-install-criteria). Chrome 154 also reported zero installability errors without one in the browser checks. The intended kitchen flow is Chrome's **Install app** / home-screen installation; use **Open as window** if offered on desktop. This does not require an APK or native wrapper.

## Network, updates and session safety

No service worker is installed. No fetch interception, precache, API cache, offline operational snapshot or worker-held session material is introduced. Normal content-hashed Next JS/CSS can use the existing browser/CDN cache; a refreshed page references the deployed asset versions. There is no waiting-worker or activation cycle that can pin the app to an old shell. Refresh the installed app, or close and relaunch it, after deployment. An already open editing session is not forcibly reloaded.

CPU's existing actor-scoped IndexedDB projections and authority validation policy remain in place. A fresh launch requires the live cache-scope/authentication request before reading that cache. Existing network-error fallback behaviour elsewhere in the application is not redesigned by this PWA task. The PWA adds no offline data availability promise.

Existing server authentication and authorisation remain authoritative, using the existing cookie/session and Hub access checks. CPU previously displayed a 401 error without navigating to sign-in. The new CPU response handler sends 401 responses to the existing configured Hub sign-in entry with `returnTo` pointing directly back to CPU and `appId=cpu-production`. It does not redirect 403 permission denials or 5xx/network errors, and does not create a separate login/session store. Dashboard and allergen responses use the same redirect. Warm dashboard authentication failures no longer return a cached projection as a successful result. The existing staging Hub return-origin allowlist includes the CPU custom hostname.

The manifest and branding files contain public metadata only. Operational APIs keep their existing `cache: no-store` requests. No production plan, allergen, signature, authority/reuse, order/booking or auth/session response is placed in a service-worker cache. No new polling, business writes or Firestore audit writes are introduced by installation or page reads.

## Validation performed before rollout

- `tsx --test tests/cpu-pwa.test.ts tests/cpu-tablet-layout-contract.test.ts tests/cpu-warm-cache-authority.test.ts tests/cpu-production.test.ts`: **59 passed, 0 failed**.
- `npm run typecheck`: passed.
- `npm run build`: passed with the branch's locked Next 16.2.12.
- Initial checks exposed a stale installed shared-package copy and stale generated Next types from another lineage. `npm ci --ignore-scripts --no-audit --no-fund` refreshed the unchanged lockfile dependencies; rebuilding regenerated types. No dependency version or lockfile was changed.
- `git diff --check`: passed.
- Style Guide compliance: **PASS**. Existing responsive layout and CSS are preserved; literal manifest/metadata colours mirror existing tokens as required by those browser APIs.

Automated Chrome 154.0.8037.99 checks used a temporary, read-only static harness serving the real built shell/assets and mocked API responses. The normal local Next server startup was rejected by automatic approval review without a specific reason; the safer harness does not execute operational backend routes. It uses a separate browser profile, not the user's authenticated profile or CPU UAT state.

Browser outcomes:

| Check | Result |
| --- | --- |
| Parsed manifest | No errors; expected fields and real PNG icons |
| Chrome installability | Zero installability errors |
| Desktop installation | Installed through Chrome DevTools PWA API; removed after testing |
| Standalone launch | Confirmed direct CPU start URL and `(display-mode: standalone)`, with Chrome's open-as-window preference selected |
| Desktop / tablet widths | 1440, 900 portrait and 1280 landscape; no horizontal page overflow; existing tablet bar breakpoint preserved |
| Android tablet emulation | Android UA/mobile/touch metrics; zero installability errors; navigation drawer touch action passed |
| Refresh / update simulation | New HTML marker fetched after simulated server revision; fresh API requests on reload |
| Expired session | Mocked 401 navigates to existing Hub sign-in with direct CPU return URL |
| Offline refresh | Network navigation fails instead of serving a stale worker shell |
| Worker / Cache Storage | Zero registered service workers and zero Cache Storage entries |

These browser checks prove the built shell and CPU client behaviour, not a real kitchen tablet's home-screen installation or successful live Google sign-in. Physical Android installation, browser/OS-specific install-menu wording and the live authenticated standalone kitchen workflow remain device confirmations. The already-passed physical tablet responsive check is retained as the baseline.

## Staging rollout and live verification

Push only this dedicated branch, then invoke the existing staging deployment wrapper for `cpu-production` with a clean worktree and exact committed SHA. Target backend: `fika-cpu-production-staging`, project: `fika-os-dev`. Do not merge main or deploy another backend/production.

After rollout completes, verify the App Hosting build's source SHA and Cloud Run serving revision, fetch the custom-origin manifest/icons/HTML, compare the canonical root's page asset URL with the baseline, and exercise an invalid/expired-session request in a fresh browser context. Live installability/standalone checks can use an isolated Chrome profile without reading authenticated production data. Report actual rollout/source/revision evidence in the task response; this document records the validation and procedure, not a fabricated deployment outcome.

On the kitchen tablet, open the staging custom URL in Chrome, use the install/home-screen action, then open **FIKA CPU** from the home screen. Confirm it starts directly in CPU without the normal address bar, rotates correctly and returns through the existing Hub sign-in if its session has expired.
