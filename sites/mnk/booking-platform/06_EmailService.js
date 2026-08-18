function sendNewBookingNotification_(booking, integration) {
  try {
    const recipientConfig = parseNotificationRecipients_(booking.client.email);

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
    const subject = SITE_CONFIG.clientFacingName +
      " booking request received | " + booking.bookingId;
    const plainText = buildBookingNotificationText_(
      booking,
      eventType
    );

    MailApp.sendEmail({
      to: recipientConfig.valid.join(","),
      subject: subject,
      body: plainText,
      htmlBody: buildBookingNotificationHtml_(
        booking,
        eventType
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

function buildBookingNotificationText_(booking, eventType) {
  return [
    "Hi " + booking.client.name + ",",
    "",
    "Thank you. Your " + SITE_CONFIG.clientFacingName + " booking request has been received.",
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
    "",
    "This request is subject to confirmation. The hospitality team will contact you once it has been reviewed."
  ].filter(function(line, index, values) {
    return line !== "" || values[index - 1] !== "";
  }).join("\n");
}

function buildBookingNotificationHtml_(booking, eventType) {
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
    ["Estimated total", formatNotificationMoney_(booking.order.netTotal)]
  ];

  return [
    '<div style="font-family:Arial,sans-serif;color:#07506f;max-width:620px">',
    '<div style="background:#176f8e;color:#fff;padding:24px 28px;border-radius:0">',
    '<div style="font-size:12px;font-weight:bold;letter-spacing:1.4px;text-transform:uppercase">Hospitality brochure 2026</div>',
    '<h1 style="font-size:26px;margin:8px 0 0">Booking request received</h1>',
    '</div>',
    '<div style="padding:26px 28px;border:1px solid #c7dfe8;border-top:0;border-radius:0">',
    '<p style="margin-top:0;color:#4d7890">Hi ' + escapeNotificationHtml_(booking.client.name) + ', thank you. Your hospitality booking request has been received.</p>',
    '<table style="width:100%;border-collapse:collapse">',
    rows.map(function(row) {
      return '<tr>' +
        '<td style="padding:9px 8px;border-bottom:1px solid #e4f1f5;color:#4d7890">' +
        escapeNotificationHtml_(row[0]) +
        '</td>' +
        '<td style="padding:9px 8px;border-bottom:1px solid #e4f1f5;text-align:right;font-weight:bold">' +
        escapeNotificationHtml_(row[1]) +
        '</td>' +
        '</tr>';
    }).join(""),
    '</table>',
    '<p style="font-size:12px;color:#4d7890;margin-bottom:0">This request is subject to confirmation. The hospitality team will contact you once it has been reviewed.</p>',
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
