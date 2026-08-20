# FIKA OS local launcher

This is a deliberately small local-only launcher for the FIKA OS development apps.

```text
node tools/launcher/server.mjs
```

Then open <http://localhost:3100>. The root `npm run dev` workflow starts the launcher and opens this one page in the browser.

The launcher is passive: it reads supervisor/session state, polls the configured app URLs, and opens currently running apps. Application processes are owned by `fikaos`, not by browser actions.
