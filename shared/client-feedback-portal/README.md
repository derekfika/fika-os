# FIKA Multi-Site Hospitality Feedback Portal

One public Apps Script web app serves every registered hospitality dashboard.
Each dashboard retains its own settings, feedback requests, responses and
item-level ratings.

## Angel Court setup

```js
setFeedbackSiteSpreadsheetId(
  "angel_court",
  "1Bjdu4-5OBbsZuMEGCJIKr5nTH5cfWA0gEEQcfGvGh5c"
);
setupFeedbackPortal("angel_court");
```

Deploy this project once with public anonymous access. Put the same deployed
`/exec` URL into each dashboard's `Feedback Settings > FEEDBACK_WEB_APP_URL`,
then run:

```js
installFeedbackRequestTrigger();
```

Because the web app executes as the deploying user, that Google account must
have Editor access to every registered dashboard spreadsheet. Run
`verifyFeedbackSiteAccess()` before deployment to confirm access.

The single trigger loops through all configured sites. It only sends when the
live dashboard row is still `CONFIRMED`, 24 hours have passed since event end,
and the booking remains inside the 72-hour sending window.

## Adding another site

1. Add one entry to `FEEDBACK_SITES` in `00_Config.js`.
2. Give it a unique `spreadsheetPropertyKey`.
3. Run `setFeedbackSiteSpreadsheetId("new_site_id", "sheet ID or URL")`.
4. Run `setupFeedbackPortal("new_site_id")`.
5. Fill in that dashboard's `Feedback Settings` sheet.

No additional feedback deployment or trigger is required.

Run `getFeedbackRegistryStatus()` at any time to see which registered sites
have a spreadsheet configured.

## Demo

The demo dashboard is registered as `demo` and is configured for immediate
feedback links. The demo booking platform writes a feedback request as soon as
a demo booking is submitted, then emails the link to `derek@fikacatering.com`.
