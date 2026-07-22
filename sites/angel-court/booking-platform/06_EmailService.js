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

    const dashboardUrl = getBookingNotificationDashboardUrl_(
      settings.DASHBOARD_URL
    );
    const eventType = eventTypeLabel_(booking.order.eventType);
    const subject =
      "New Angel Court booking request | " +
      booking.event.eventDate +
      " | " +
      booking.client.companyName;
    const plainText = buildBookingNotificationText_(
      booking,
      eventType,
      dashboardUrl,
      integration
    );

    MailApp.sendEmail({
      to: recipientConfig.valid.join(","),
      subject: subject,
      body: plainText,
      htmlBody: buildBookingNotificationHtml_(
        booking,
        eventType,
        dashboardUrl,
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
    return getBookingSpreadsheet_().getUrl();
  } catch (error) {
    return "";
  }
}

function buildBookingNotificationText_(booking, eventType, dashboardUrl, integration) {
  return [
    "A new booking request has been added to the Angel Court Hospitality Dashboard.",
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
    "Dashboard status: " + integration.dashboardStatus,
    dashboardUrl ? "" : "",
    dashboardUrl ? "Open dashboard: " + dashboardUrl : "",
    "",
    "Please review the request and prepare the quote."
  ].filter(function(line, index, values) {
    return line !== "" || values[index - 1] !== "";
  }).join("\n");
}

function buildBookingNotificationHtml_(booking, eventType, dashboardUrl, integration) {
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
    ["Dashboard status", integration.dashboardStatus]
  ];

  return [
    '<div style="font-family:Avenir,Arial,sans-serif;color:#323437;max-width:620px">',
    '<div style="background:#63666a;color:#fff;padding:24px 28px;border-radius:14px 14px 0 0">',
    '<div style="font-size:12px;font-weight:bold;letter-spacing:1.4px;text-transform:uppercase">One Angel Court</div>',
    '<h1 style="font-size:26px;margin:8px 0 0">New hospitality booking</h1>',
    '</div>',
    '<div style="padding:26px 28px;border:1px solid #dedbea;border-top:0;border-radius:0 0 14px 14px">',
    '<p style="margin-top:0;color:#63666a">A new client booking request is ready for review.</p>',
    '<table style="width:100%;border-collapse:collapse">',
    rows.map(function(row) {
      return '<tr>' +
        '<td style="padding:9px 8px;border-bottom:1px solid #e4e4e4;color:#63666a">' +
        escapeNotificationHtml_(row[0]) +
        '</td>' +
        '<td style="padding:9px 8px;border-bottom:1px solid #eeeaf4;text-align:right;font-weight:bold">' +
        escapeNotificationHtml_(row[1]) +
        '</td>' +
        '</tr>';
    }).join(""),
    '</table>',
    dashboardUrl
      ? '<p style="margin:24px 0 8px"><a href="' +
        escapeNotificationHtml_(dashboardUrl) +
        '" style="display:inline-block;background:#62baea;color:#ffffff;padding:12px 18px;border-radius:9px;text-decoration:none;font-weight:bold">Open hospitality dashboard</a></p>'
      : "",
    '<p style="font-size:12px;color:#63666a;margin-bottom:0">Please review the request and prepare the quote.</p>',
    '</div>',
    '</div>'
  ].join("");
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
