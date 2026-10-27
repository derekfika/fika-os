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
