function sendNewBookingNotification_(booking, integration) {
  try {
    const settings = getPlatformSettings_();
    const recipientConfig = parseNotificationRecipients_(
      [
        settings.SITE_EMAIL_ADDRESS,
        settings.NOTIFICATION_RECIPIENTS
      ].filter(Boolean).join(",")
    );

    if (!recipientConfig.valid.length) {
      return {
        sent: false,
        reason: recipientConfig.invalid.length
          ? "No valid notification recipients were configured."
          : "Notifications are disabled."
      };
    }

    if (recipientConfig.invalid.length) {
      console.warn(
        "Ignored invalid booking notification recipients: " +
        recipientConfig.invalid.join(", ")
      );
    }

    const eventType = eventTypeLabel_(booking.order.eventType);
    const subject =
      "New " + SITE_CONFIG.clientFacingName + " booking request | " +
      booking.event.eventDate +
      " | " +
      booking.client.companyName;
    const plainText = buildBookingNotificationText_(
      booking,
      eventType,
      integration
    );

    MailApp.sendEmail({
      to: recipientConfig.valid.join(","),
      subject: subject,
      body: plainText,
      htmlBody: buildBookingNotificationHtml_(
        booking,
        eventType,
        integration
      ),
      name: SITE_CONFIG.clientFacingName
    });

    return {
      sent: true,
      recipients: recipientConfig.valid
    };
  } catch (error) {
    // The dashboard row is already safely written. Notification failure must
    // never make the client think their booking submission was lost.
    console.error(
      "New booking notification failed for " +
      booking.bookingId +
      ": " +
      error.message
    );
    return {
      sent: false,
      reason: error.message
    };
  }
}

function parseNotificationRecipients_(value) {
  const valid = [];
  const invalid = [];
  const seen = {};

  String(value || "")
    .split(/[\s,;]+/)
    .map(function(email) { return email.trim(); })
    .filter(Boolean)
    .forEach(function(email) {
      const key = email.toLowerCase();
      if (seen[key]) return;
      seen[key] = true;

      if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        valid.push(email);
      } else {
        invalid.push(email);
      }
    });

  return { valid: valid, invalid: invalid };
}

function getBookingNotificationDashboardUrl_(configuredUrl) {
  const value = String(configuredUrl || "").trim();
  if (/^https:\/\/\S+$/i.test(value)) return value;

  try {
    return getDashboardSpreadsheet_().getUrl();
  } catch (error) {
    return "";
  }
}

function buildBookingNotificationText_(booking, eventType, integration) {
  const lineItems = buildBookingNotificationLineItemsText_(booking);
  return [
    "A new " + SITE_CONFIG.clientFacingName + " booking request is ready for review.",
    "",
    "Reference: " + booking.bookingId,
    "Company: " + booking.client.companyName,
    "Contact: " + booking.client.name,
    "Contact email: " + booking.client.email,
    "Contact phone: " + booking.client.phone,
    booking.client.invoiceReference
      ? "Invoice reference: " + booking.client.invoiceReference
      : "",
    "Event: " + eventType,
    "Date: " + booking.event.eventDate,
    "Time: " + booking.event.startTime +
      (booking.event.endTime ? " - " + booking.event.endTime : ""),
    "Guests: " + booking.event.guestCount,
    "Floor / area: " + [
      booking.event.floorLevel,
      booking.event.roomOrArea
    ].filter(Boolean).join(" / "),
    "Estimated total: " + formatNotificationMoney_(booking.order.netTotal),
    "Request status: " + integration.dashboardStatus,
    "",
    "Line items:",
    lineItems || "No line items were captured.",
    "",
    "Please review the request and prepare the quote."
  ].filter(function(line, index, values) {
    return line !== "" || values[index - 1] !== "";
  }).join("\n");
}

function buildBookingNotificationHtml_(booking, eventType, integration) {
  const rows = [
    ["Reference", booking.bookingId],
    ["Company", booking.client.companyName],
    ["Contact", booking.client.name],
    ["Contact email", booking.client.email],
    ["Contact phone", booking.client.phone],
    ["Invoice reference", booking.client.invoiceReference || "Not provided"],
    ["Event", eventType],
    ["Date", booking.event.eventDate],
    ["Time", booking.event.startTime +
      (booking.event.endTime ? " - " + booking.event.endTime : "")],
    ["Guests", booking.event.guestCount],
    ["Floor / area", [
      booking.event.floorLevel,
      booking.event.roomOrArea
    ].filter(Boolean).join(" / ")],
    ["Estimated total", formatNotificationMoney_(booking.order.netTotal)],
    ["Request status", integration.dashboardStatus]
  ];
  const lineItemsHtml = buildBookingNotificationLineItemsHtml_(booking);

  return [
    '<div style="font-family:Gilroy,Arial,sans-serif;color:#280F8C;max-width:680px;background:#F4F3FF;border:1px solid #ddd7ff">',
    '<div style="background:#4F34C7;color:#fff;padding:24px 28px 26px;border-radius:0">',
    '<img src="https://fikacatering.com/assets/fika_logoRGB.png" alt="FIKA" style="display:block;width:104px;height:auto;margin:0 0 18px;filter:brightness(0) invert(1)">',
    '<div style="font-size:11px;font-weight:bold;letter-spacing:1.7px;text-transform:uppercase;opacity:.78">Hospitality booking request</div>',
    '<h1 style="font-family:Arial,sans-serif;font-size:28px;line-height:1.08;margin:8px 0 0;color:#fff">New ' + escapeNotificationHtml_(SITE_CONFIG.clientFacingName) + ' booking</h1>',
    '</div>',
    '<div style="padding:28px;background:#fff;border-top:0;border-radius:0">',
    '<p style="margin:0 0 18px;color:#5F5A82;font-size:14px;line-height:1.5">A new client booking request is ready for review. The requested menu items are included below.</p>',
    '<table style="width:100%;border-collapse:collapse;margin:0 0 24px">',
    rows.map(function(row) {
      return '<tr>' +
        '<td style="padding:10px 8px;border-bottom:1px solid #ECE8FF;color:#6F67A8;font-size:13px">' +
        escapeNotificationHtml_(row[0]) +
        '</td>' +
        '<td style="padding:10px 8px;border-bottom:1px solid #ECE8FF;text-align:right;font-weight:bold;color:#280F8C;font-size:13px">' +
        escapeNotificationHtml_(row[1]) +
        '</td>' +
        '</tr>';
    }).join(""),
    '</table>',
    '<h2 style="font-size:15px;letter-spacing:1.3px;text-transform:uppercase;margin:0 0 12px;color:#4F34C7">Line items</h2>',
    lineItemsHtml || '<p style="margin:0 0 22px;color:#6F67A8">No line items were captured.</p>',
    '<p style="font-size:12px;color:#6F67A8;margin:24px 0 0">Please review the request and prepare the quote.</p>',
    '</div>',
    '</div>'
  ].join("");
}

function buildBookingNotificationLineItemsText_(booking) {
  return (booking.order.items || []).map(function(item) {
    const details = buildBookingNotificationItemDetails_(item);
    return [
      "- " + item.itemName + " x " + item.quantity + " (" + formatNotificationMoney_(item.lineTotal) + ")",
      details ? "  " + details : ""
    ].filter(Boolean).join("\n");
  }).join("\n");
}

function buildBookingNotificationLineItemsHtml_(booking) {
  return (booking.order.items || []).map(function(item) {
    const details = buildBookingNotificationItemDetails_(item);
    return [
      '<div style="padding:14px 0;border-bottom:1px solid #ECE8FF">',
      '<div style="display:flex;gap:12px;justify-content:space-between;align-items:flex-start">',
      '<div>',
      '<strong style="display:block;color:#280F8C;font-size:15px;line-height:1.25">' + escapeNotificationHtml_(item.itemName) + '</strong>',
      '<span style="display:block;margin-top:4px;color:#6F67A8;font-size:12px">' + escapeNotificationHtml_(item.category || item.servingInfo || "") + '</span>',
      '</div>',
      '<div style="text-align:right;white-space:nowrap;color:#280F8C;font-weight:bold;font-size:14px">',
      escapeNotificationHtml_(item.quantity) + ' x ' + escapeNotificationHtml_(formatNotificationMoney_(item.unitPrice)),
      '<br><span style="font-size:13px;color:#4F34C7">' + escapeNotificationHtml_(formatNotificationMoney_(item.lineTotal)) + '</span>',
      '</div>',
      '</div>',
      details ? '<div style="margin-top:9px;color:#5F5A82;font-size:12px;line-height:1.45">' + escapeNotificationHtml_(details) + '</div>' : '',
      '</div>'
    ].join("");
  }).join("");
}

function buildBookingNotificationItemDetails_(item) {
  const choices = (item.choices || [])
    .filter(function(choice) { return choice && choice.value !== "" && choice.value !== null && choice.value !== undefined; })
    .map(function(choice) {
      return choice.label + ": " + (Array.isArray(choice.value) ? choice.value.join(", ") : choice.value);
    });
  return [
    item.timeRequired ? "Time: " + item.timeRequired : "",
    item.description || "",
    choices.join("; "),
    item.comments ? "Comment: " + item.comments : ""
  ].filter(Boolean).join(" | ");
}

function formatNotificationMoney_(value) {
  return "GBP " + Number(value || 0).toFixed(2);
}

function escapeNotificationHtml_(value) {
  return String(value === null || value === undefined ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
