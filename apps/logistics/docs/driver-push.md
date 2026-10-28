# Logistics driver Web Push (PR 2)

Push is a second delivery channel for the same committed notices the inbox already shows. It never replaces or blocks the inbox.

## How a push is sent

1. A planner change commits its change event; the processor turns it into inbox notices in a transaction (unchanged). Each new notice
   is created with `pushStatus: "pending"`.
2. **After** that commit, and never inside a transaction, the notice is pushed. After a planner save this runs once the HTTP response
   has been sent (Next `after()`), so a slow push service cannot slow Franco's planner. The recovery route runs it inline.
3. Sending first **claims** the notice (a transaction on `pushStatus`), so the post-save sender and the recovery job can never push the
   same notice twice. Eligibility is **rechecked at send time**: a notice for another service date, or older than 15 minutes, is marked
   `expired` and never delivered late. The push service is also given a 15 minute TTL.
4. The notice is sent to every device registered for that van and no other. Results: `sent`, `none` (no devices), `pending`
   (transient failure, retried), `failed` (parked after 3 attempts), `expired`. A 404/410 from the push service deletes that device.
5. Recovery (`POST /api/logistics/driver-notifications/process`, scheduler) also retries notices still `pending`, bounded.

Push failure never changes the inbox notice, the planner save or the change event.

## Devices and isolation

- A browser subscription is stored in `fikaLogisticsPushSubscriptionsV1/{sha256(endpoint)}` with the **vehicle from the signed PIN
  session**; any vehicle in the request body is ignored. Endpoint and keys are never returned by any API.
- Only HTTPS endpoints of the real push services are accepted (FCM, Mozilla, Apple, Windows): the server posts to that URL.
- A van can remove only its own devices. The same phone signing in as the other van moves its subscription (latest wins), so one
  phone can never receive both vans. At most 10 devices per van (least recently updated dropped).
- Staging and production are separate Firestore projects and separate VAPID keys: a subscription is only valid for the environment
  whose public key it was created with. Production needs its own key pair and secret; it is **not** configured by this change.

## VAPID

`LOGISTICS_VAPID_PRIVATE_KEY` (secret) and `LOGISTICS_VAPID_SUBJECT` come from the App Hosting environment. The public key is
**derived from the private key** at runtime, so they cannot disagree (the derived key was checked against the configured
`LOGISTICS_VAPID_PUBLIC_KEY`). Without a private key push is off: registration is refused and nothing is sent. Keys are never
logged or returned.

## The driver app

More has a Push notifications card: turn on (asks the browser for permission on a tap), send a test notification (to this van only,
at most one every 20 seconds), turn off. iPhone only delivers web push to the installed Home Screen app, so a Safari tab is told to
add it to the Home Screen first. A blocked permission says how to fix it. On open, a phone that already allowed notifications quietly
refreshes its registration; the app never prompts by itself.

Tapping a push opens (or focuses) the app and opens that notice: the app loads the freshly authoritative run and marks the notice
read, exactly like tapping it in the inbox. The deep link is only a notice id; the destination is decided from loaded data.

## Android back

Only the Run screen lets the back gesture leave the app. Notifications, More, the stop sheet and the issue dialog each take one
history entry, so back closes just that layer.

## Testing on staging

1. Open the van app on the phone (Pixel: Van 1; Karol's installed iPhone app: Van 2), sign in with the PIN, More, turn on
   notifications, allow the prompt, send a test notification.
2. Make a planner change on today's UAT run: the right phone should buzz within seconds; the other phone must not.
3. A change on a future date must send nothing. Check `pushStatus` on the notice and `pushRetried` from the recovery route.

## Limits

- Push delivery is best-effort: the push service may delay or drop a message (the inbox is the record).
- iOS needs the Home Screen app and iOS 16.4 or later.
- Capture failures (no event) cannot be pushed; see `driver-notifications-coverage.md`.

## Why each van has its own worker (Android attribution)

Installed apps on Android only own their notifications when the service worker that shows them sits **inside that app's manifest
scope**. Van 1's manifest scope is `/mobile/van1` and Van 2's is `/mobile/van2`, but the shared worker was registered at `/mobile/`,
which contains neither. Chromium then attributes the notification to Chrome (its settings open under Sites, not the app). Chromium's
source rule for this is from a 2016 code review and was not re-checked against current Chrome; the Pixel test is the confirmation.

Each van now registers `/pwa-sw.js` at its own scope (`/mobile/van1`, `/mobile/van2`) from its own page. Each registration has its
own push subscription, so a phone's Van 1 and Van 2 endpoints are different and cannot be mixed up. The server still decides the van
from the signed PIN session: a browser may only register the scope that matches its session (`LOGISTICS_PUSH_SCOPE_MISMATCH`, 403).

## Migration from the shared subscription

The old shared subscription (no `scope`, treated as `shared`) is never deleted up front. The rules, in `driver-push-store.ts`:

1. A new van-scoped subscription is created with `replaces` naming the legacy endpoint (when the phone has one).
2. The server **proves the new endpoint with a real verification push** before doing anything else. That notification reads
   "Notifications are on" for that van.
3. Only if the push is accepted does the new subscription become `verified`, and only then is the legacy subscription marked
   `supersededBy`. A legacy subscription is only retired by a replacement for the same van.
4. Sending skips a superseded legacy subscription, and skips a van-scoped replacement that has not been verified yet. So a device
   receives exactly one copy at every step: the legacy one until the replacement is proven, then the replacement alone.
5. If the replacement's endpoint is rejected (410/404) it is removed and the legacy subscription is left alone. If the push service
   is only temporarily failing, the replacement stays unverified and the legacy one keeps delivering; the next app open retries.

Nothing unsubscribes a device or unregisters `/mobile/` up front. Superseded legacy endpoints are simply never sent to.

## Notification click

Each worker derives its van from its **own registration scope**, not from the payload. A payload for the other van is shown as a
generic "FIKA Logistics" notice that opens the worker's own van. A tap focuses only a window of that same van, never the other van's
window, and falls back to opening the van's app at the notice.

## Pixel test (Van 1)

1. Open **FIKA Van 1** from the app drawer (the installed app, not a Chrome tab).
2. Sign in with the Van 1 PIN, then More, and tap **Turn on notifications** and allow the prompt.
3. Tap **Send a test notification**. A notification should arrive titled "Test notification" and show the FIKA Van 1 icon.
4. Long-press the notification: the header should name **FIKA Van 1** (or "Van 1"), not Chrome.
5. Android Settings → Apps → FIKA Van 1 → Notifications should show that it has posted notifications.
6. Tap the notification: it should open FIKA Van 1 at the notice, not the Van 2 app or a Chrome tab.
7. Van 2 must stay isolated: a Van 1 notice must not appear on a Van 2 phone and the reverse, and Van 2's app must not be focused by a
   Van 1 tap.

If step 4 still shows Chrome, report the notification header text and the Settings path you see.
