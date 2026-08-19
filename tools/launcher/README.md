# FIKA OS local launcher

This is a deliberately small local-only launcher for the FIKA OS development apps.

```text
node tools/launcher/server.mjs
```

Then open <http://localhost:3100>. The root `npm run dev` workflow starts the launcher and opens this one page in the browser.

Offline app cards expose a `Start app` action. It runs that app's existing `npm run dev` from the configured app directory, sets its configured port, and refreshes status. Planned apps such as Logistics remain disabled until they have an implementation.
