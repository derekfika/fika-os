const FEEDBACK_REPORTING_CONFIG = Object.freeze({
  appName: "FIKA Feedback Reporting",
  timeZone: "Europe/London",
  sheets: {
    requests: "Feedback Requests",
    responses: "Feedback Responses",
    itemRatings: "Feedback Item Ratings"
  },
  colours: {
    ink: "#241F33",
    muted: "#6F67A8",
    paper: "#f4f3ff",
    surface: "#ffffff",
    primary: "#4F34C7",
    accent: "#4DF7C2",
    warning: "#FFE800",
    danger: "#FF5C00"
  }
});

const FEEDBACK_REPORTING_SITES = Object.freeze([
  {
    siteId: "all",
    siteName: "All Sites",
    spreadsheetId: "",
    propertyKey: ""
  },
  {
    siteId: "demo",
    siteName: "FIKA Hospitality",
    spreadsheetId: "1YwoWOifOYIT35aZbAdxGxXVGRsrvRBPuJkPQNkuj3Ow",
    propertyKey: "DEMO_DASHBOARD_SPREADSHEET_ID"
  },
  {
    siteId: "mnk",
    siteName: "MNK",
    spreadsheetId: "1GIGIh_oAY0yLrrlXPaSvHte2oMPT8S_dKFAYdZN6nuc",
    propertyKey: "MNK_DASHBOARD_SPREADSHEET_ID"
  },
  {
    siteId: "angel_court",
    siteName: "Angel Court",
    spreadsheetId: "1Bjdu4-5OBbsZuMEGCJIKr5nTH5cfWA0gEEQcfGvGh5c",
    propertyKey: "ANGEL_COURT_DASHBOARD_SPREADSHEET_ID"
  },
]);

function setupFeedbackPortals(){
  setupFeedbackPortal('angelcourt');
  setupFeedbackPortal('demo');
  setupFeedbackPortal('mnk');
  
}
