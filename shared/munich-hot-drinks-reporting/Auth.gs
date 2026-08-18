const REPORTING_ACCESS_PIN_PROPERTY = "REPORTING_ACCESS_PIN";
const REPORTING_ACCESS_DEFAULT_PIN = "2026";
const REPORTING_ACCESS_TOKEN_PREFIX = "REPORTING_ACCESS_";
const REPORTING_ACCESS_TOKEN_SECONDS = 43200;

function verifyReportingPin(pin) {
  const expected = String(PropertiesService.getScriptProperties().getProperty(REPORTING_ACCESS_PIN_PROPERTY) || REPORTING_ACCESS_DEFAULT_PIN);
  if (String(pin || "").trim() !== expected) {
    Utilities.sleep(350);
    throw new Error("Incorrect PIN. Please try again.");
  }
  const token = Utilities.getUuid();
  CacheService.getScriptCache().put(reportingAccessTokenKey_(token), "ok", REPORTING_ACCESS_TOKEN_SECONDS);
  return {
    ok: true,
    token: token,
    expiresInSeconds: REPORTING_ACCESS_TOKEN_SECONDS
  };
}

function setReportingAccessPin(pin) {
  const text = String(pin || "").trim();
  if (!/^\d{4,8}$/.test(text)) throw new Error("Use a numeric PIN between 4 and 8 digits.");
  PropertiesService.getScriptProperties().setProperty(REPORTING_ACCESS_PIN_PROPERTY, text);
  return { ok: true, message: "Reporting app PIN updated." };
}

function requireReportingAccess_(payload) {
  const token = String((payload || {}).pinToken || "").trim();
  if (!token || !CacheService.getScriptCache().get(reportingAccessTokenKey_(token))) {
    throw new Error("Enter the reporting PIN to access this app.");
  }
}

function reportingAccessTokenKey_(token) {
  return REPORTING_ACCESS_TOKEN_PREFIX + String(token || "").replace(/[^A-Za-z0-9_-]/g, "");
}
