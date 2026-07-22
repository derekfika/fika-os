const HOT_DRINKS_CONFIG = {
  appName: "Munich RE Hot Drinks",
  timezone: "Europe/London",
  sheets: {
    drinkLog: "Drink_Log",
    settings: "Settings",
    dashboardData: "Dashboard_Data",
    auditLog: "Audit_Log"
  },
  floors: ["3rd Floor", "5th Floor"],
  drinks: ["Coffee", "Cappuccino", "Latte", "Flat White", "Tea", "Hot Chocolate", "Chai", "Drink Special"],
  source: "HOT_DRINK_TALLY_WEB_APP",
  duplicateWindowMs: 750,
  openingHours: [
    "08:00-12:00",
    "14:00-16:30"
  ],
  timeBuckets: [
    { label: "08:00-09:00", start: "08:00", end: "09:00", closed: false },
    { label: "09:00-10:00", start: "09:00", end: "10:00", closed: false },
    { label: "10:00-11:00", start: "10:00", end: "11:00", closed: false },
    { label: "11:00-12:00", start: "11:00", end: "12:00", closed: false },
    { label: "12:00-14:00", start: "12:00", end: "14:00", closed: true },
    { label: "14:00-15:00", start: "14:00", end: "15:00", closed: false },
    { label: "15:00-16:00", start: "15:00", end: "16:00", closed: false },
    { label: "16:00-16:30", start: "16:00", end: "16:30", closed: false }
  ]
};

const DRINK_LOG_HEADERS = [
  "ID", "Timestamp", "Date", "Time", "Floor", "Drink", "Device/User", "Source", "Status", "Client Tap ID"
];

const SETTINGS_HEADERS = ["Type", "Name", "Value", "Enabled", "Notes"];
const DASHBOARD_DATA_HEADERS = ["Generated At", "Start Date", "End Date", "Filters JSON", "Summary JSON"];
const AUDIT_LOG_HEADERS = ["Timestamp", "Action", "Submission ID", "Floor", "Drink", "Device/User", "Details"];

function getDefaultSettingsRows_() {
  const rows = [];
  HOT_DRINKS_CONFIG.floors.forEach(function(floor) {
    rows.push(["Floor", floor, floor, true, "Available in the barista floor selector."]);
  });
  HOT_DRINKS_CONFIG.drinks.forEach(function(drink) {
    rows.push(["Drink", drink, drink, true, "Shown as a large tally button."]);
  });
  HOT_DRINKS_CONFIG.openingHours.forEach(function(hours) {
    rows.push(["Opening Hours", hours, hours, true, "Used for reporting context."]);
  });
  rows.push(["Closed Period", "Lunch", "12:00-14:00", true, "Shown as closed/lunch in heatmaps."]);
  rows.push(["Bank Holiday", "Example", "", false, "Enter YYYY-MM-DD in Value and enable when required."]);
  rows.push(["Reporting Default", "Default preset", "today", true, "Initial dashboard preset."]);
  return rows;
}
