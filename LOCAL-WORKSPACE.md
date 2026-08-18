# FIKA OS local workspace

Use `Start-FIKA-OS-All.cmd` to start the Firebase Auth/Firestore emulator and the current local apps in separate labelled terminal windows. It also opens the Hub, MNK Hospitality and CPU Production URLs.

| App | URL | Port |
|---|---|---:|
| Integration Hub | http://localhost:3200 | 3200 |
| MNK Hospitality | http://localhost:3300/mnk | 3300 |
| CPU Production | http://localhost:3400 | 3400 |
| Menu Planning | http://localhost:3500 | 3500 |
| Beverage Innovation | http://localhost:3600 | 3600 |
| Events Dashboard | http://localhost:3700 | 3700 |
| Firebase Emulator UI | http://127.0.0.1:4005 | 4005 |

Use `Stop-FIKA-OS-All.ps1` when finished. It stops processes listening on these reserved local development ports only. It does not stop unrelated applications or modify emulator exports.

The launcher waits for the Auth and Firestore emulator ports before starting the dependent apps (up to 60 seconds). It imports `FIKA-RESTORED-DATA.json` when that verified local data pointer exists. Otherwise it starts an empty local emulator. It never connects to production Firebase.
