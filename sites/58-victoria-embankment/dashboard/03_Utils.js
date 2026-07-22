function getBookingSiteCode_() {
  const configured = getConfiguredValue_(
    "LOCATION_SHORT_CODE",
    CONFIG.LOCATION_SHORT_CODE || "58VE"
  );

  const cleaned = String(configured || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "");

  return cleaned && cleaned !== "UNDEFINED" && cleaned !== "NULL"
    ? cleaned
    : "58VE";
}

function generateBookingId_(dateValue) {

  const now =
    Object.prototype.toString.call(dateValue) === "[object Date]" &&
    !isNaN(dateValue.getTime())
      ? dateValue
      : new Date();

  const datePart = Utilities.formatDate(
    now,
    Session.getScriptTimeZone(),
    "yyyyMMdd"
  );

  const rand = Math.floor(Math.random() * 1000)
    .toString()
    .padStart(3, "0");

  const siteCode = getBookingSiteCode_();

  return `${siteCode}-${datePart}-${rand}`;
}
