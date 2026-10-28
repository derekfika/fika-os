# 2026-10-28 — Van 1 and Van 2 install from a fresh browser

Chrome fetches the install manifest and icons without a session. The middleware matcher
skipped static files by extension but not `.webmanifest`, so a logged-out browser got a
307 to the sign-in page, and Chrome could not install the app (Install was disabled).
Signed-in browsers were unaffected. Install metadata, icons and the worker script are now
excluded from the middleware and admitted by it; the van pages stay gated as before.

Affected domain/boundary: Logistics driver app install and access routing (middleware).

Validation: typecheck; 682 unit/route tests including manifest identity, scope, start URL,
icon sizes for both vans, distinct app identities, the served manifest link, the matcher and
logged-out admission; production build. Physical installs on the OPPO and the Pixel are
checked on staging after deploy.

Deployment: none at merge; staging after merge is recorded in the release record.
