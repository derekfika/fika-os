# Hospitality Menu Studio

Studio is an independent authoring app for [#586](https://github.com/derekfika/fika-os/issues/586). Hub retains commercial catalogue and booking authority. The current Hub Rotations lifecycle remains operational during implementation.

## Local development

Install from the governed task checkout with `npm ci --prefix apps/hospitality-menu-studio`. In the app directory start `firebase emulators:start --only firestore --project demo-fika-os --config firebase.emulator.json` with a dedicated Firestore port. Set `FIREBASE_PROJECT_ID=demo-fika-os` and `FIRESTORE_EMULATOR_HOST=127.0.0.1:8896`, then use `fika dev menu-studio --workspace <task> --port <unused-port>`. For local UI fixtures, opt into `FIKA_STUDIO_LOCAL_PREVIEW=1` and open the loopback address. Fixture access requires development mode, a demo project and loopback dependencies.

## Access and data

Studio asks Hub to verify the caller's session and explicit organisation-wide Rotations View and Manage grants. Draft mutations need a current version and a same-origin request. Successful changes atomically update the draft and append its exact actor-bound revision. Exact retries of a prior save return its acknowledgement while it is the latest save. Lists read a 50-record page plus one continuation record. Draft previews fetch the dishes for the selected event date. A review reads the saved menu and its referenced dishes. There is no background polling or outbound job.

Cloud draft writes and the App Hosting runtime remain closed. Studio staging requires separate backend provisioning, verified service identity and data isolation, Studio-specific grants and Hub return-to-Studio registration. [Studio staging preflight](../../docs/deployment/hospitality-menu-studio-staging.md)

Customer preview is for drafting. Signed menu content, commercial eligibility, booking impact, special activation, booking and production integration and published restore require the remaining #586 increments.
