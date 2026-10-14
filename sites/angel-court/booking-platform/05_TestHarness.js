function runBookingPlatformTests() {
  const payload = {
    client: {
      name: "Alex Smith",
      email: "alex@example.com",
      phone: "07123456789",
      companyName: "Requester Ltd",
      invoiceReference: "PO-12345",
      clientName: "Jamie Client",
      clientCompanyName: "Example Client Ltd"
    },
    event: {
      eventDate: futureWeekday_(15),
      startTime: "09:00",
      endTime: "10:00",
      guestCount: 20,
      floorLevel: "7"
    },
    order: {
      eventType: "breakfast",
      items: [{ itemId: "baps", quantity: 10, choices: [{ id: "filling", value: "Mixed" }] }]
    },
    dietaries: { hasDietaries: false },
    acknowledgements: {
      quoteSubjectToConfirmation: true,
      noticePolicyAccepted: true,
      dietaryResponsibilityAccepted: true
    }
  };

  const booking = buildServerBooking_(payload);
  const validation = validateBookingRequest_(booking);
  const tampered = JSON.parse(JSON.stringify(payload));
  tampered.order.items[0].unitPrice = 0.01;
  tampered.order.items[0].lineTotal = 0.1;
  const protectedBooking = buildServerBooking_(tampered);
  const dashboardBooking = adaptClientBookingForDashboard_(protectedBooking);
  const notificationText = buildBookingNotificationText_(protectedBooking, "Breakfast");
  const notificationHtml = buildBookingNotificationHtml_(protectedBooking, "Breakfast");
  const publicPolicy = getPublicPlatformConfig().site.copy.cancellationPolicy;
  const escapedBooking = JSON.parse(JSON.stringify(protectedBooking));
  escapedBooking.client.name = "<Alex & Co>";
  const escapedNotificationHtml = buildBookingNotificationHtml_(escapedBooking, "Breakfast");
  const missingReferencePayload = JSON.parse(JSON.stringify(payload));
  missingReferencePayload.client.invoiceReference = "";
  const missingClientNamePayload = JSON.parse(JSON.stringify(payload));
  missingClientNamePayload.client.clientName = "";
  const missingClientCompanyPayload = JSON.parse(JSON.stringify(payload));
  missingClientCompanyPayload.client.clientCompanyName = "";
  const missingAcknowledgementPayload = JSON.parse(JSON.stringify(payload));
  missingAcknowledgementPayload.acknowledgements.noticePolicyAccepted = false;
  const gallagherFour = testBookingPayload_(payload, { client: { clientCompanyName: "Gallagher" }, event: { guestCount: 4 } });
  const gallagherFive = testBookingPayload_(payload, { client: { clientCompanyName: "GALLAGHER" }, event: { guestCount: 5 } });
  const gallagherInvalidGuests = testBookingPayload_(payload, { client: { clientCompanyName: "Gallagher" }, event: { guestCount: "not-a-number" } });
  const gallagherMissingReference = testBookingPayload_(payload, { client: { clientCompanyName: "Gallagher", invoiceReference: "" } });
  const gallagherSmallMin = recalculateOrderItems_([{ itemId: "nibble_bowls", quantity: 3 }], 5, true)[0];
  const gallagherTenMin = recalculateOrderItems_([{ itemId: "baps", quantity: 5 }], 5, true)[0];
  const standardTenMin = recalculateOrderItems_([{ itemId: "baps", quantity: 10 }], 20, false)[0];
  const charges100FourHours = calculateBuildingCharges_({ guestCount: 100, startTime: "09:00", endTime: "13:00" });
  const chargeBoundaries = [99, 100, 199, 200, 299, 300].map(function(guests) {
    return calculateBuildingCharges_({ guestCount: guests, startTime: "09:00", endTime: "13:00" }).security.count;
  });
  const noEndLarge = testBookingPayload_(payload, { event: { guestCount: 100, endTime: "" } });
  const missingEndSmall = testBookingPayload_(payload, { event: { guestCount: 99, endTime: "" } });
  const aircon18to21 = calculateBuildingCharges_({ guestCount: 99, startTime: "18:00", endTime: "21:00" });
  const aircon1930to21 = calculateBuildingCharges_({ guestCount: 99, startTime: "19:30", endTime: "21:00" });
  const airconEndingAt19 = calculateBuildingCharges_({ guestCount: 99, startTime: "18:00", endTime: "19:00" });
  const chargePayload = testBookingPayload_(payload, {
    event: { guestCount: 100, startTime: "09:00", endTime: "13:00" },
    order: { eventType: "bespoke", items: [] }
  });
  const chargeBooking = buildServerBooking_(chargePayload);
  const chargeDashboard = adaptClientBookingForDashboard_(chargeBooking);
  const chargeNotification = buildBookingNotificationText_(chargeBooking, "Bespoke enquiry");
  const airconChargeBooking = buildServerBooking_(testBookingPayload_(payload, {
    event: { guestCount: 99, startTime: "18:00", endTime: "21:00" },
    order: { eventType: "bespoke", items: [] }
  }));
  const airconChargeDashboard = adaptClientBookingForDashboard_(airconChargeBooking);

  const tests = [
    { name: "valid payload passes", ok: validation.ok },
    { name: "cancellation policy is configured", ok: SITE_CONFIG.rules.cancellationWindowHours === 72 && publicPolicy.windowHours === SITE_CONFIG.rules.cancellationWindowHours && publicPolicy.summary === "Cancellations made within 72 hours of the scheduled service time may incur a charge of up to 100% of the catering cost." },
    { name: "full policy includes reductions and committed costs", ok: publicPolicy.paragraphs.length === 6 && publicPolicy.paragraphs[3].indexOf("partial cancellation") !== -1 && publicPolicy.paragraphs[4].indexOf("committed costs") !== -1 },
    { name: "cancellation acknowledgement is captured", ok: protectedBooking.acknowledgements.noticePolicyAccepted && protectedBooking.acknowledgements.cancellationPolicyAccepted && protectedBooking.acknowledgements.cancellationPolicyHours === 72 },
    { name: "request email plain text contains cancellation policy", ok: publicPolicy.requestParagraphs.every(function(paragraph) { return notificationText.indexOf(paragraph) !== -1; }) && notificationText.indexOf("This request is subject to confirmation") !== -1 },
    { name: "request email HTML contains escaped cancellation policy", ok: publicPolicy.requestParagraphs.every(function(paragraph) { return notificationHtml.indexOf(escapeNotificationHtml_(paragraph)) !== -1; }) && notificationHtml.indexOf("This request is subject to confirmation") !== -1 },
    { name: "request email escapes booking information", ok: escapedNotificationHtml.indexOf("&lt;Alex &amp; Co&gt;") !== -1 && escapedNotificationHtml.indexOf("<Alex & Co>") === -1 },
    { name: "request email retains request status", ok: notificationText.indexOf("booking request has been received") !== -1 && notificationText.indexOf("booking is confirmed") === -1 },
    { name: "server uses schema unit price", ok: protectedBooking.order.items[0].unitPrice === 3.95 },
    { name: "server recalculates total", ok: protectedBooking.order.netTotal === 39.5 },
    { name: "site is config driven", ok: protectedBooking.siteId === SITE_CONFIG.siteId },
    { name: "structured choice retained", ok: protectedBooking.order.items[0].choices[0].value === "Mixed" },
    { name: "dashboard adapter produces READY booking", ok: dashboardBooking.status === "READY" },
    { name: "dashboard adapter produces quote item shape", ok: dashboardBooking.items[0].section === "Breakfast" && dashboardBooking.items[0].qty === 10 },
    { name: "dashboard adapter preserves client payload", ok: dashboardBooking.clientBooking.bookingId === protectedBooking.bookingId },
    { name: "dashboard adapter uses client company", ok: dashboardBooking.clientCompany === "Example Client Ltd" },
    { name: "dashboard adapter uses client name as host", ok: dashboardBooking.hostName === "Jamie Client" },
    { name: "dashboard adapter adds 8% management fee", ok: dashboardBooking.mgmtFee === 3.16 && dashboardBooking.netPrice === 42.66 },
    { name: "invoice reference reaches dashboard JSON", ok: dashboardBooking.invoiceReference === "PO-12345" && dashboardBooking.notes.indexOf("PO-12345") !== -1 },
    { name: "invoice reference is mandatory", ok: !validateBookingRequest_(buildServerBooking_(missingReferencePayload)).ok },
    { name: "client name is mandatory", ok: !validateBookingRequest_(buildServerBooking_(missingClientNamePayload)).ok },
    { name: "client company is mandatory", ok: !validateBookingRequest_(buildServerBooking_(missingClientCompanyPayload)).ok },
    { name: "missing cancellation acknowledgement is rejected", ok: !validateBookingRequest_(buildServerBooking_(missingAcknowledgementPayload)).ok },
    { name: "serving suggestion schema is public", ok: getPublicPlatformConfig().menu.find(function(item) { return item.id === "mini_pastries"; }).serves === 12 },
    { name: "removed Classic Working Lunch is not public", ok: !getPublicPlatformConfig().menu.some(function(item) { return item.id === "classic_working_lunch"; }) },
    { name: "spreadsheet URL ID extraction", ok: extractSpreadsheetId_("https://docs.google.com/spreadsheets/d/1ExampleSpreadsheetId123456789/edit#gid=0") === "1ExampleSpreadsheetId123456789" },
    { name: "spreadsheet ID extraction", ok: extractSpreadsheetId_("1ExampleSpreadsheetId123456789") === "1ExampleSpreadsheetId123456789" },
    { name: "sheet gid is rejected", ok: extractSpreadsheetId_("123456789") === "" },
    { name: "notification recipients parse", ok: parseNotificationRecipients_("one@example.com; two@example.com\none@example.com").valid.length === 2 },
    { name: "invalid notification recipient is reported", ok: parseNotificationRecipients_("valid@example.com, not-an-email").invalid[0] === "not-an-email" },
    { name: "client company Gallagher is detected", ok: isGallagherBooking_({ clientCompanyName: "Gallagher", email: "person@example.com" }) },
    { name: "company normalization is case and punctuation insensitive", ok: isGallagherBooking_({ clientCompanyName: " G.A.L.L.A.G.H.E.R! ", email: "person@example.com" }) },
    { name: "Gallagher-ish is not detected", ok: !isGallagherBooking_({ clientCompanyName: "Gallagher-ish", email: "person@example.com" }) },
    { name: "exact Redington email domain is detected", ok: isGallagherBooking_({ clientCompanyName: "Other", email: "frontofhouse@redington.co.uk" }) },
    { name: "email substring or subdomain is not detected", ok: !isGallagherBooking_({ clientCompanyName: "Other", email: "person@notredington.co.uk" }) && !isGallagherBooking_({ clientCompanyName: "Other", email: "person@sub.redington.co.uk" }) },
    { name: "Gallagher booking with 4 guests is rejected", ok: validateBookingRequest_(buildServerBooking_(gallagherFour)).errors.some(function(error) { return error.indexOf("at least 5 guests") !== -1; }) },
    { name: "Gallagher booking with 5 guests is accepted", ok: validateBookingRequest_(buildServerBooking_(gallagherFive)).ok },
    { name: "Gallagher non-numeric guest count is rejected", ok: !validateBookingRequest_(buildServerBooking_(gallagherInvalidGuests)).ok },
    { name: "Gallagher product minimum 10 is capped at 5", ok: gallagherTenMin.minimumOrder === 5 && gallagherTenMin.minimumOrderMet },
    { name: "Gallagher product minimum 6 is capped at 5", ok: effectiveProductMinimum_(6, true) === 5 },
    { name: "Gallagher product minimum 3 remains 3", ok: gallagherSmallMin.minimumOrder === 3 },
    { name: "non-Gallagher product minimum is unchanged", ok: standardTenMin.minimumOrder === 10 },
    { name: "Gallagher missing invoice reference is rejected server-side", ok: validateBookingRequest_(buildServerBooking_(gallagherMissingReference)).errors.some(function(error) { return error.indexOf("Reference number is required") !== -1; }) },
    { name: "99 guests have no housekeeping or security", ok: calculateBuildingCharges_({ guestCount: 99, startTime: "09:00", endTime: "13:00" }).housekeeping.total === 0 && calculateBuildingCharges_({ guestCount: 99, startTime: "09:00", endTime: "13:00" }).security.total === 0 },
    { name: "100 guests and four hours calculate one-housekeeper and eight-hour security charges", ok: charges100FourHours.housekeeping.total === 94.72 && charges100FourHours.housekeeping.hours === 4 && charges100FourHours.security.count === 1 && charges100FourHours.security.total === 239.6 },
    { name: "housekeeping stays at one resource as guest count rises", ok: calculateBuildingCharges_({ guestCount: 300, startTime: "09:00", endTime: "13:00" }).housekeeping.total === 94.72 },
    { name: "security counts at 99/100/199/200/299/300 boundaries", ok: JSON.stringify(chargeBoundaries) === JSON.stringify([0, 1, 1, 2, 2, 3]) },
    { name: "100+ guests without end time are rejected", ok: !validateBookingRequest_(buildServerBooking_(noEndLarge)).ok },
    { name: "99 guests without end time remain valid", ok: validateBookingRequest_(buildServerBooking_(missingEndSmall)).ok },
    { name: "18:00-21:00 charges two aircon hours", ok: aircon18to21.aircon.hours === 2 && aircon18to21.aircon.total === 400 },
    { name: "19:30-21:00 charges one and a half aircon hours", ok: aircon1930to21.aircon.hours === 1.5 && aircon1930to21.aircon.total === 300 },
    { name: "event ending at 19:00 has no aircon charge", ok: airconEndingAt19.aircon.total === 0 },
    { name: "building charges appear as separate quote rows and email lines", ok: ["Housekeeping", "Security"].every(function(label) { return chargeDashboard.items.some(function(item) { return item.name === label && item.section === "Building Charges"; }) && chargeNotification.indexOf(label + ":") !== -1; }) },
    { name: "aircon appears as its own quote row", ok: airconChargeDashboard.items.some(function(item) { return item.name === "Aircon after 7pm" && item.lineTotal === 400; }) },
    { name: "building charges enter existing management fee and VAT totals", ok: chargeDashboard.totalPrice === charges100FourHours.total && chargeDashboard.mgmtFee === 26.75 && chargeDashboard.netPrice === 361.07 && chargeDashboard.vat === 72.21 && chargeDashboard.grossPrice === 433.28 }
  ];
  return { ok: tests.every(function(test) { return test.ok; }), tests: tests };
}

function testBookingPayload_(base, updates) {
  const result = JSON.parse(JSON.stringify(base));
  Object.keys(updates || {}).forEach(function(section) {
    result[section] = Object.assign(result[section] || {}, updates[section]);
  });
  return result;
}

function futureWeekday_(daysAhead) {
  const date = new Date();
  date.setDate(date.getDate() + daysAhead);
  return Utilities.formatDate(date, SITE_CONFIG.timeZone, "yyyy-MM-dd");
}
