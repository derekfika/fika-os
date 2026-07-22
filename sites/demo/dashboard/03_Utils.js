function generateBookingId_() {

  const now = new Date();

  const datePart = Utilities.formatDate(
    now,
    Session.getScriptTimeZone(),
    "yyyyMMdd"
  );

  const rand = Math.floor(Math.random() * 1000)
    .toString()
    .padStart(3, "0");

  const siteCode = getConfiguredValue_(
  "SITE_CODE",
  CONFIG.SITE_CODE
);

return `${siteCode}-${datePart}-${rand}`;
}