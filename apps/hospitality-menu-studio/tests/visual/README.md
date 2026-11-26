# Menu Studio visual fixtures

The Chromium harness captures seven screens with deterministic fictional data at the reference dimensions and at 1440 × 900, 1024 × 768, and 390 × 844. It uses Studio’s real UI and intercepts the Studio API requests in the browser. These captures support visual comparison. Hosted acceptance and tests of Hub, CPU, publication, and booking authority use their own workflows.

## Run

Use a governed isolated checkout with Studio’s dependencies installed. Launch Studio on a free loopback port with `FIKA_RUNTIME_MODE=local`, `FIREBASE_PROJECT_ID=demo-fika-os`, `FIKA_STUDIO_LOCAL_PREVIEW=1`, and emulator auth. The fixture page makes no Hub or emulator requests. Set the expected SHA to the source of the running server. Retain the exact source for the before captures before editing the UI.

From the Studio app directory:

```powershell
node --import tsx --test tests/visual/fixtures.test.mjs
node tests/visual/capture.mjs --base http://127.0.0.1:13422 `
    --expect-sha <full-source-sha> --output <absolute-new-archive-directory> `
    --playwright <absolute-path-to-playwright-package> --checks
```

If Playwright resolves from Studio’s normal module paths, omit `--playwright`. Use a Chromium installation that matches that Playwright release. For a single baseline screen add `--screens 03 --viewports native`. Screen 01 uses 1672 × 941 at native size. Screens 02–07 use 1671 × 941. Use a new archive destination for every attempt you want to retain.

Each screenshot has a JSON manifest with the build identity returned by Studio, viewport, fixture and image hashes, browser versions, loopback URL, request log and page-level overflow measurement. Keep the same fixture hash and browser for before and after. A fresh browser context starts each capture. The renderer uses London time, British English, locally loaded fonts and reduced motion.

Pass `--working-tree` when capturing an uncommitted development candidate. This records that the server’s reported source SHA identifies its base. For side-by-side and adjustable overlays after capture:

```powershell
node tests/visual/compare.mjs --references <approved-extracted-image-directory> `
    --before <before-archive-directory> --after <after-archive-directory> `
    --output <absolute-new-gallery.html>
```

The gallery requires matching fixture hashes, Chromium versions and native dimensions. Use `--screens 03` for a per-screen gallery.

`--checks` also verifies the cold Builder bootstrap and gzip request limits, lazy Dish Library reads, batched immutable dish revisions without duplicates, absence of eager legacy menu reads and absence of a request when searching the Builder or Catalogue. The browser blocks external origins, unscoped API requests, API requests missing from the fixture, and every mutation.

On the replacement shell use `--shell-interactions` with screen 03 to check local status filters, keyboard create and cancel with focus return, opening a saved menu, and Escape and focus return in tablet and mobile navigation. The JSON manifest records the checks and document and viewport widths.

Review shows the real UI’s unavailable publication authority for the local actor. The fixture carries fictional commercial display values and no signed safety or publication records. Treat any change that needs genuine readiness, publication, activation or booking evidence as a separate authorised test.
