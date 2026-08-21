const REPORTING_ACCESS_PIN_PROPERTY = "REPORTING_ACCESS_PIN";
const REPORTING_ACCESS_DEFAULT_PIN = "2026";
const REPORTING_ACCESS_SECRET_PROPERTY = "REPORTING_ACCESS_SECRET";
const REPORTING_ACCESS_TOKEN_SECONDS = 43200;

function verifyReportingPin(pin) {
  const expected = String(PropertiesService.getScriptProperties().getProperty(REPORTING_ACCESS_PIN_PROPERTY) || REPORTING_ACCESS_DEFAULT_PIN);
  if (String(pin || "").trim() !== expected) {
    Utilities.sleep(350);
    throw new Error("Incorrect PIN. Please try again.");
  }
  const expiresAt = Date.now() + REPORTING_ACCESS_TOKEN_SECONDS * 1000;
  const nonce = Utilities.getUuid();
  const tokenBody = expiresAt + "." + nonce;
  const token = tokenBody + "." + signReportingAccessToken_(tokenBody);
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
  if (!isValidReportingAccessToken_(token)) {
    throw new Error("Enter the reporting PIN to access this app.");
  }
}

function isValidReportingAccessToken_(token) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) return false;
  const expiresAt = Number(parts[0]);
  const nonce = parts[1];
  const signature = parts[2];
  if (!expiresAt || !nonce || !signature || expiresAt < Date.now()) return false;
  const tokenBody = expiresAt + "." + nonce;
  return signature === signReportingAccessToken_(tokenBody);
}

function signReportingAccessToken_(tokenBody) {
  const signature = Utilities.computeHmacSha256Signature(tokenBody, getReportingAccessSecret_());
  return Utilities.base64EncodeWebSafe(signature).replace(/=+$/, "");
}

function getReportingAccessSecret_() {
  const properties = PropertiesService.getScriptProperties();
  let secret = properties.getProperty(REPORTING_ACCESS_SECRET_PROPERTY);
  if (!secret) {
    secret = Utilities.getUuid() + Utilities.getUuid();
    properties.setProperty(REPORTING_ACCESS_SECRET_PROPERTY, secret);
  }
  return secret;
}
