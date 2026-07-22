# Hospitality Feedback Reporting Dashboard

Shared reporting app for feedback across all hospitality platforms.

## Features

* Filter by site, date range, rating and request status.
* All-site KPI summary.
* Site comparison.
* Rating distribution.
* Recent client comments.
* CSV export.
* PDF export.

## Site Setup

FIKA Hospitality and MNK have committed dashboard spreadsheet IDs. Other sites can be wired by running:

```js
setFeedbackReportingSiteSpreadsheetId("angel_court", "SPREADSHEET_ID_OR_URL");
setFeedbackReportingSiteSpreadsheetId("cfc", "SPREADSHEET_ID_OR_URL");
setFeedbackReportingSiteSpreadsheetId("58ve", "SPREADSHEET_ID_OR_URL");
```

The deploying Google account needs Editor access to each dashboard spreadsheet.
