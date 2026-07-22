function runBookingPlatformTests() {
  const payload = {
    client: { name: "Alex Smith", email: "alex@example.com", phone: "07123456789", companyName: "Example Ltd", invoiceReference: "PO-12345" },
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

  const tests = [
    { name: "valid payload passes", ok: validation.ok },
    { name: "server uses schema unit price", ok: protectedBooking.order.items[0].unitPrice === 3.95 },
    { name: "server recalculates total", ok: protectedBooking.order.netTotal === 39.5 },
    { name: "site is config driven", ok: protectedBooking.siteId === SITE_CONFIG.siteId },
    { name: "structured choice retained", ok: protectedBooking.order.items[0].choices[0].value === "Mixed" },
    { name: "dashboard adapter produces READY booking", ok: dashboardBooking.status === "READY" },
    { name: "dashboard adapter produces quote item shape", ok: dashboardBooking.items[0].section === "Breakfast" && dashboardBooking.items[0].qty === 10 },
    { name: "dashboard adapter preserves client payload", ok: dashboardBooking.clientBooking.bookingId === protectedBooking.bookingId },
    { name: "invoice reference reaches dashboard JSON", ok: dashboardBooking.invoiceReference === "PO-12345" && dashboardBooking.notes.indexOf("PO-12345") !== -1 },
    { name: "serving suggestion schema is public", ok: getPublicPlatformConfig().menu.find(function(item) { return item.id === "mini_pastries"; }).serves === 12 },
    { name: "spreadsheet URL ID extraction", ok: extractSpreadsheetId_("https://docs.google.com/spreadsheets/d/1ExampleSpreadsheetId123456789/edit#gid=0") === "1ExampleSpreadsheetId123456789" },
    { name: "spreadsheet ID extraction", ok: extractSpreadsheetId_("1ExampleSpreadsheetId123456789") === "1ExampleSpreadsheetId123456789" },
    { name: "sheet gid is rejected", ok: extractSpreadsheetId_("123456789") === "" },
    { name: "notification recipients parse", ok: parseNotificationRecipients_("one@example.com; two@example.com\none@example.com").valid.length === 2 },
    { name: "invalid notification recipient is reported", ok: parseNotificationRecipients_("valid@example.com, not-an-email").invalid[0] === "not-an-email" }
  ];
  return { ok: tests.every(function(test) { return test.ok; }), tests: tests };
}

function futureWeekday_(daysAhead) {
  const date = new Date();
  date.setDate(date.getDate() + daysAhead);
  return Utilities.formatDate(date, SITE_CONFIG.timeZone, "yyyy-MM-dd");
}
