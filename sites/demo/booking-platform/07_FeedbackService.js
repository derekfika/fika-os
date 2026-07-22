const DEMO_FEEDBACK_REQUEST_HEADERS = [
  "Feedback Token", "Booking Reference", "Client Email", "Client Name",
  "Event Date", "Event Type", "Request Due", "Request Sent", "Request Sent Date",
  "Opened", "Opened Date", "Completed", "Completed Date", "Booking Snapshot JSON",
  "Site ID"
];

const DEMO_FEEDBACK_RESPONSE_HEADERS = [
  "Feedback ID", "Booking Reference", "Submitted At", "Overall Satisfaction",
  "Food Quality", "Presentation", "Delivery Timing", "Ease Of Booking", "NPS",
  "What Went Well", "Improvements", "Additional Comments", "Contact Requested",
  "Preferred Contact Details", "Feedback JSON", "Site ID"
];

const DEMO_FEEDBACK_ITEM_HEADERS = [
  "Feedback ID", "Booking Reference", "Item ID", "Item Name", "Quantity",
  "Rating", "Comments", "Site ID"
];

function sendDemoFeedbackRequest_(dashboardBooking) {
  try {
    if (!SITE_CONFIG.feedback.enabled) return { sent: false, reason: "Feedback is disabled." };
    const settings = getPlatformSettings_();
    const recipient = normaliseDemoFeedbackRecipient_(settings.DEMO_FEEDBACK_RECIPIENT);
    if (!recipient) return { sent: false, reason: "No feedback recipient configured." };

    const webAppUrl = String(settings.FEEDBACK_WEB_APP_URL || SITE_CONFIG.feedback.webAppUrl || "").trim();
    if (!/^https:\/\/\S+\/exec(?:\?|$)/i.test(webAppUrl)) {
      return { sent: false, reason: "Feedback web app URL is missing or invalid." };
    }

    const spreadsheet = getDashboardSpreadsheet_();
    const requestSheet = getOrCreateSheet_(spreadsheet, "Feedback Requests", DEMO_FEEDBACK_REQUEST_HEADERS);
    getOrCreateSheet_(spreadsheet, "Feedback Responses", DEMO_FEEDBACK_RESPONSE_HEADERS);
    getOrCreateSheet_(spreadsheet, "Feedback Item Ratings", DEMO_FEEDBACK_ITEM_HEADERS);
    const token = Utilities.base64EncodeWebSafe(Utilities.getUuid() + Utilities.getUuid()).replace(/=+$/g, "");
    const now = new Date();
    requestSheet.appendRow([
      token,
      dashboardBooking.bookingId,
      dashboardBooking.hostEmail || recipient,
      dashboardBooking.hostName || "",
      dashboardBooking.eventDate || "",
      dashboardBooking.serviceType || "",
      now,
      true,
      now,
      false,
      "",
      false,
      "",
      JSON.stringify(dashboardBooking),
      SITE_CONFIG.siteId
    ]);

    sendDemoFeedbackEmail_(dashboardBooking, recipient, buildDemoFeedbackLink_(webAppUrl, token));
    return { sent: true, recipient: recipient };
  } catch (error) {
    console.error("Feedback request failed: " + error.message);
    return { sent: false, reason: error.message };
  }
}

function normaliseDemoFeedbackRecipient_(value) {
  const email = String(value || SITE_CONFIG.feedback.recipient || "").trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}

function buildDemoFeedbackLink_(webAppUrl, token) {
  return webAppUrl + (webAppUrl.indexOf("?") === -1 ? "?" : "&") +
    "token=" + encodeURIComponent(token);
}

function sendDemoFeedbackEmail_(booking, recipient, link) {
  const subject = "We'd love your feedback | FIKA Hospitality";
  const bookingDate = formatDemoFeedbackDate_(booking.eventDate);
  const body = [
    "Hi there,",
    "",
    "Thank you for choosing FIKA Hospitality.",
    "",
    "We hope everything went perfectly with your recent booking. We'd really appreciate hearing about your experience.",
    "",
    "Your booking details",
    "Reference: " + booking.bookingId,
    "Client: " + (booking.clientCompany || ""),
    "Booking date: " + bookingDate,
    "",
    "Share your experience: " + link,
    "",
    "Thank you for helping us deliver exceptional hospitality.",
    "",
    "The FIKA Team"
  ].join("\n");
  const html = [
    '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0;padding:0;background:#F4F3FF;width:100%">',
    '<tr><td align="center" style="padding:28px 14px">',
    '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;max-width:640px;background:#FFFFFF;border:1px solid #E4DFFF;border-radius:18px;overflow:hidden">',
    '<tr><td style="background:#4F34C7;color:#FFFFFF;padding:34px 38px 36px">',
    '<img src="https://fikacatering.com/assets/fika_logoRGB.png" alt="FIKA" width="104" style="display:block;width:104px;max-width:104px;height:auto;margin:0 0 22px;border:0;filter:brightness(0) invert(1)">',
    '<div style="font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:bold;letter-spacing:1.8px;text-transform:uppercase;color:#FFFFFF;opacity:.82">FIKA Hospitality</div>',
    '<h1 style="font-family:Arial,Helvetica,sans-serif;font-size:34px;line-height:1.08;margin:10px 0 10px;color:#FFFFFF;font-weight:bold">We&rsquo;d love your feedback</h1>',
    '<p style="font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.5;margin:0;color:#FFFFFF;opacity:.88">Help us make every FIKA experience even better.</p>',
    '</td></tr>',
    '<tr><td style="padding:36px 38px 34px;background:#FFFFFF;color:#241176;font-family:Arial,Helvetica,sans-serif">',
    '<p style="font-size:15px;line-height:1.6;margin:0 0 18px;color:#241176">Hi there,</p>',
    '<p style="font-size:15px;line-height:1.6;margin:0 0 18px;color:#241176">Thank you for choosing FIKA Hospitality.</p>',
    '<p style="font-size:15px;line-height:1.6;margin:0 0 26px;color:#241176">We hope everything went perfectly with your recent booking. We&rsquo;d really appreciate hearing about your experience, and it only takes around 60 seconds.</p>',
    '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;margin:0 0 30px;background:#F7F5FF;border:1px solid #E4DFFF;border-radius:14px">',
    '<tr><td style="padding:22px 24px">',
    '<div style="font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:bold;letter-spacing:1.4px;text-transform:uppercase;color:#4F34C7;margin:0 0 14px">Your booking details</div>',
    demoFeedbackDetailRow_("Reference", booking.bookingId),
    demoFeedbackDetailRow_("Client", booking.clientCompany || ""),
    demoFeedbackDetailRow_("Booking date", bookingDate),
    '</td></tr>',
    '</table>',
    '<div style="font-size:20px;letter-spacing:2px;color:#D9A51A;margin:0 0 14px;text-align:center" aria-hidden="true">&#9733;&#9733;&#9733;&#9733;&#9733;</div>',
    '<p style="font-size:16px;line-height:1.5;margin:0 0 16px;color:#241176;text-align:center;font-weight:bold">Ready to share your thoughts?</p>',
    '<table role="presentation" cellspacing="0" cellpadding="0" align="center" style="margin:0 auto 30px">',
    '<tr><td align="center" bgcolor="#4DF7C2" style="border-radius:10px;background:#4DF7C2">',
    '<a href="' + escapeDemoFeedbackHtml_(link) + '" aria-label="Share your FIKA Hospitality experience" style="display:inline-block;min-width:220px;padding:16px 28px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:18px;font-weight:bold;color:#241176;text-decoration:none;border-radius:10px">Share your experience &rarr;</a>',
    '</td></tr>',
    '</table>',
    '<p style="font-size:15px;line-height:1.6;margin:0 0 4px;color:#241176">Thank you for helping us deliver exceptional hospitality.</p>',
    '<p style="font-size:15px;line-height:1.6;margin:0 0 24px;color:#241176;font-weight:bold">The FIKA Team</p>',
    '<p style="font-size:12px;line-height:1.55;margin:0;color:#716C8E">Your feedback goes directly to the FIKA management team and helps us continuously improve our food, service and hospitality.</p>',
    '</td></tr>',
    '</table>',
    '</td></tr>',
    '</table>'
  ].join("");
  MailApp.sendEmail({
    to: recipient,
    subject: subject,
    body: body,
    htmlBody: html,
    name: SITE_CONFIG.clientFacingName
  });
}

function demoFeedbackDetailRow_(label, value) {
  return [
    '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;border-top:1px solid #E7E2FF">',
    '<tr>',
    '<td style="padding:12px 0 10px;font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:bold;letter-spacing:.8px;text-transform:uppercase;color:#716C8E;width:38%;vertical-align:top">',
    escapeDemoFeedbackHtml_(label),
    '</td>',
    '<td style="padding:12px 0 10px;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:bold;color:#241176;text-align:right;vertical-align:top">',
    escapeDemoFeedbackHtml_(value || "Not provided"),
    '</td>',
    '</tr>',
    '</table>'
  ].join("");
}

function formatDemoFeedbackDate_(value) {
  const text = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const parts = text.split("-").map(Number);
  const date = new Date(parts[0], parts[1] - 1, parts[2]);
  return Utilities.formatDate(date, SITE_CONFIG.timeZone, "d MMMM yyyy");
}

function escapeDemoFeedbackHtml_(value) {
  return String(value === null || value === undefined ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
