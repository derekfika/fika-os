# FIKA Impact Tracker deployment

## Build

From `sites/fika-impact`, run:

```bash
npm install
npm run build
```

The complete static website is generated in:

```text
sites/fika-impact/out/
```

No Node.js process, API, database, Vercel project, Cloudflare Worker, or other backend is required after the build.

## Upload with FileZilla

1. Connect to the hosting account for `www.fikacatering.com`.
2. Open the public web root and navigate to `tools/impact-tracker/`. Create those folders if they do not already exist.
3. Upload the **contents** of `sites/fika-impact/out/` into `tools/impact-tracker/`.
4. Confirm that `index.html`, `_next/`, the FIKA logo files, and `one-liverpool-street.png` sit directly inside that destination.
5. Visit `https://www.fikacatering.com/tools/impact-tracker/` and perform a hard refresh.

Do not upload the `out` folder itself as an extra nested directory. The correct result is `tools/impact-tracker/index.html`, not `tools/impact-tracker/out/index.html`.

## Is `.htaccess` required?

No. The application has one exported route, uses a physical `index.html`, includes trailing-slash-compatible links, and needs no rewrites.

If the hosting account disables directory indexes, enable `DirectoryIndex index.html` in the hosting control panel or add that single directive to the existing site-level `.htaccess`. Do not add a single-page-app fallback or redirect all requests to this application.

## Deploying updates

1. Pull or copy the latest source.
2. Run `npm install` if dependencies changed.
3. Run `npm run build`.
4. In FileZilla, replace the contents of `tools/impact-tracker/` with the newly generated contents of `out/`.
5. Remove obsolete hashed files under `_next/static/` if FileZilla did not replace the destination cleanly.
6. Hard-refresh the live page and verify the FIKA and One Liverpool Street logos, custom fonts, automatic rotation, and changing figures.

## Troubleshooting

- **Unstyled page or missing scripts:** confirm the page is being visited with `/tools/impact-tracker/` and that `_next/` was uploaded beside `index.html`.
- **404s for fonts or JavaScript:** upload the complete fresh `_next/` directory. Do not rename its files.
- **Missing logos:** confirm `fika-logo.png`, `fika-logo-white.png`, and `one-liverpool-street.png` are directly beside `index.html`.
- **Old design still appears:** hard-refresh the browser, clear any hosting cache, and remove obsolete `_next/static/` files before uploading the new folder again.
- **Page refresh gives 404:** confirm `index.html` exists at `tools/impact-tracker/index.html` and directory indexes are enabled.
- **Presentation appears paused:** press Space once. The data simulation and rotation resume automatically after a normal page refresh.
