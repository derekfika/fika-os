# FIKA OS foreground development supervisor

Use `fikaos.bat` from the repository root:

```text
fikaos
fikaos --fresh
fikaos status
fikaos stop
```

Normal startup requires the verified `FIKA-RESTORED-DATA.json` pointer. It imports that export and writes a new shutdown export under `local-data/integration-hub/recovery/`. `--fresh` deliberately skips import and starts a blank emulator.

The supervisor keeps Firebase, all application servers, and the passive launcher attached to one foreground process. The browser launcher only reports status and opens already-running apps.
