# MNK client hospitality portal

Read-only booking history for Felipe, hosted by the Fika Google account.

## Security model

- Deployed as a separate Apps Script project, executing as the deploying Fika account.
- Felipe does not need a Google account. The landing screen asks for a PIN.
- The PIN is checked on the server and stored in Apps Script Properties, not in this repository.
- The portal deliberately shows all MNK bookings, regardless of who originally placed them.
- Bookings are returned only after confirmation. `CONFIRMED`, `ARCHIVED` and `RECHARGED` records remain visible; a cancelled record remains in history only when it previously sent a confirmation email.
- Only the fields explicitly returned by `sanitiseClientBooking_` reach the browser.
- This project contains no mutation, quote, calendar, cancellation or recharge functions.

## Deployment

1. Create a standalone Apps Script project and add its ID to `.clasp.json`.
2. Confirm the deploying Fika account can read the MNK dashboard spreadsheet.
3. In Apps Script Project Settings > Script Properties, create `ACCESS_PIN` with the PIN Felipe should use.
4. Add the deployed MNK booking-platform URL to `BOOKING_PLATFORM_URL` if the button is wanted.
5. Deploy as a web app: execute as the deploying Fika user; access set to anyone.
6. Give Felipe the deployment URL, or point a friendly redirect URL at it, and provide his PIN separately.
7. Test the URL and PIN in a signed-out/incognito browser before sharing it.

The PIN is remembered only for the current browser tab. Change `ACCESS_PIN` to invalidate the old PIN.

After the one-time setup, run `felipepush.bat` from the repository root to push the files, update the existing deployment, commit the release and push the current Git branch.
