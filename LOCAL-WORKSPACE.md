# FIKA OS local workspace

Double-click `fikaos.bat` to start the single foreground FIKA OS supervisor. It restores the verified local Firebase dataset, starts Firebase and all local apps on their fixed ports, starts the passive launcher, and opens one browser page: the FIKA OS launcher. Use `Start-FIKA-OS-All.cmd` as the legacy fallback.

| App | URL | Port |
|---|---|---:|
| FIKA OS Launcher | http://localhost:3100 | 3100 |
| Integration Hub | http://localhost:3200 | 3200 |
| MNK Hospitality | http://localhost:3300/mnk | 3300 |
| CPU Production | http://localhost:3400 | 3400 |
| Menu Planning | http://localhost:3500 | 3500 |
| Beverage Innovation | http://localhost:3600 | 3600 |
| Events Dashboard | http://localhost:3700 | 3700 |
| Delivered-In | http://localhost:3800 | 3800 |
| Logistics (planned) | http://localhost:3900 | 3900 |
| Firebase Emulator UI | http://127.0.0.1:4005 | 4005 |

Use `fikaos stop` for a graceful supervisor shutdown, including Firebase export-on-exit. `fikaos status` reports the known session and port state. `Stop-FIKA-OS-All.ps1` remains available as a legacy fallback and force-stop tool.

Normal `fikaos` requires the verified `FIKA-RESTORED-DATA.json` pointer and imports its Firestore/Auth export. On shutdown Firebase writes a new session export under `local-data/integration-hub/recovery/`. `fikaos --fresh` is the only blank-emulator path. The launcher reports status, opens running apps, and can request a targeted app start/retry when an individual app is offline. The supervisor remains the owner of process lifecycle.

## Live cost discipline

Keep Firebase and other metered-service usage deliberately low. Follow
[COST-EFFICIENCY.md](COST-EFFICIENCY.md) for all new work: prefer scoped queries
and cached reference data, avoid short polling loops, pause refreshes for hidden
tabs, write only on real changes, and add a usage estimate before introducing a
new recurring read or write path.
