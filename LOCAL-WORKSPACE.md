# FIKA OS local workspace

Double-click `fikaos.bat` (or use `Start-FIKA-OS-All.cmd`) to start the Firebase Auth/Firestore emulator, the current local apps, and the local launcher in separate labelled terminal windows. It opens one browser page: the FIKA OS launcher.

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

Use `Stop-FIKA-OS-All.ps1` when finished. It stops processes listening on these reserved local development ports only. It does not stop unrelated applications or modify emulator exports.

The launcher waits for the Auth and Firestore emulator ports before starting the dependent apps (up to 60 seconds). It imports `FIKA-RESTORED-DATA.json` when that verified local data pointer exists. Otherwise it starts an empty local emulator. It never connects to production Firebase.
