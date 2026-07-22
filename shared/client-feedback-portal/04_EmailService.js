function sendFeedbackRequestEmail_(context, booking, token, recipientOverride) {
  const settings = getFeedbackSettings_(context);
  const baseUrl = String(settings.FEEDBACK_WEB_APP_URL || "").trim();
  if (!/^https:\/\/\S+\/exec(?:\?|$)/i.test(baseUrl)) {
    throw new Error("FEEDBACK_WEB_APP_URL is missing or is not a deployed /exec URL.");
  }
  const link = baseUrl + (baseUrl.indexOf("?") === -1 ? "?" : "&") +
    "token=" + encodeURIComponent(token);
  const bookingReference = booking.bookingId || "";
  const clientName = booking.clientCompany || booking.hostName || "";
  const bookingDate = feedbackEmailDate_(booking.eventDate);
  const logoUrl = String(settings.FIKA_LOGO_URL || "https://fikacatering.com/assets/fika_logoRGB.png").trim();
  const subject = "We'd love your feedback | FIKA Hospitality";
  const body = [
    "Hi there,",
    "",
    "Thank you for choosing FIKA Hospitality.",
    "",
    "We hope everything went perfectly with your recent booking. Whether it was breakfast, lunch, afternoon treats or an event, we'd really appreciate hearing about your experience.",
    "",
    "Your feedback helps us improve our food, service and future bookings - and it only takes around 60 seconds to complete.",
    "",
    "Your booking details",
    "Reference: " + bookingReference,
    "Client: " + clientName,
    "Booking date: " + bookingDate,
    "",
    "Ready to share your thoughts?",
    "",
    "Share your experience: " + link,
    "",
    "Thank you for helping us deliver exceptional hospitality.",
    "",
    "The FIKA Team",
    "",
    "Your feedback goes directly to the FIKA management team and helps us continuously improve our food, service and hospitality."
  ].join("\n");
  const html = [
    '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0;padding:0;background:#F4F3FF;width:100%">',
    '<tr><td align="center" style="padding:28px 14px">',
    '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;max-width:640px;background:#FFFFFF;border:1px solid #E4DFFF;border-radius:18px;overflow:hidden">',
    '<tr><td style="background:#4F34C7;color:#FFFFFF;padding:36px 38px 38px">',
    logoUrl
      ? '<img src="' + feedbackEscapeHtml_(logoUrl) + '" alt="FIKA" width="104" style="display:block;width:104px;max-width:104px;height:auto;margin:0 0 24px;border:0;filter:brightness(0) invert(1)">'
      : '',
    '<div style="font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:bold;letter-spacing:1.8px;text-transform:uppercase;color:#FFFFFF;opacity:.82">FIKA Hospitality</div>',
    '<h1 style="font-family:Arial,Helvetica,sans-serif;font-size:34px;line-height:1.08;margin:10px 0 10px;color:#FFFFFF;font-weight:bold">We&rsquo;d love your feedback</h1>',
    '<p style="font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.5;margin:0;color:#FFFFFF;opacity:.88">Help us make every FIKA experience even better.</p>',
    '</td></tr>',
    '<tr><td style="padding:36px 38px 34px;background:#FFFFFF;color:#241176;font-family:Arial,Helvetica,sans-serif">',
    '<p style="font-size:15px;line-height:1.6;margin:0 0 18px;color:#241176">Hi there,</p>',
    '<p style="font-size:15px;line-height:1.6;margin:0 0 18px;color:#241176">Thank you for choosing FIKA Hospitality.</p>',
    '<p style="font-size:15px;line-height:1.6;margin:0 0 18px;color:#241176">We hope everything went perfectly with your recent booking. Whether it was breakfast, lunch, afternoon treats or an event, we&rsquo;d really appreciate hearing about your experience.</p>',
    '<p style="font-size:15px;line-height:1.6;margin:0 0 28px;color:#241176">Your feedback helps us improve our food, service and future bookings - and it only takes around 60 seconds to complete.</p>',
    '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;margin:0 0 30px;background:#F7F5FF;border:1px solid #E4DFFF;border-radius:14px">',
    '<tr><td style="padding:22px 24px">',
    '<div style="font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:bold;letter-spacing:1.4px;text-transform:uppercase;color:#4F34C7;margin:0 0 14px">Your booking details</div>',
    feedbackDetailRow_("Reference", bookingReference),
    feedbackDetailRow_("Client", clientName),
    feedbackDetailRow_("Booking date", bookingDate),
    '</td></tr>',
    '</table>',
    '<div style="font-size:20px;letter-spacing:2px;color:#D9A51A;margin:0 0 14px;text-align:center" aria-hidden="true">&#9733;&#9733;&#9733;&#9733;&#9733;</div>',
    '<p style="font-size:16px;line-height:1.5;margin:0 0 16px;color:#241176;text-align:center;font-weight:bold">Ready to share your thoughts?</p>',
    '<table role="presentation" cellspacing="0" cellpadding="0" align="center" style="margin:0 auto 30px">',
    '<tr><td align="center" bgcolor="#4DF7C2" style="border-radius:10px;background:#4DF7C2">',
    '<a href="' + feedbackEscapeHtml_(link) + '" aria-label="Share your FIKA Hospitality experience" style="display:inline-block;min-width:220px;padding:16px 28px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:18px;font-weight:bold;color:#241176;text-decoration:none;border-radius:10px">Share your experience &rarr;</a>',
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
    to: recipientOverride || booking.hostEmail,
    subject: subject,
    body: body,
    htmlBody: html,
    name: context.site.clientFacingName
  });
}

function feedbackDetailRow_(label, value) {
  return [
    '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;border-top:1px solid #E7E2FF">',
    '<tr>',
    '<td style="padding:12px 0 10px;font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:bold;letter-spacing:.8px;text-transform:uppercase;color:#716C8E;width:38%;vertical-align:top">',
    feedbackEscapeHtml_(label),
    '</td>',
    '<td style="padding:12px 0 10px;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:bold;color:#241176;text-align:right;vertical-align:top">',
    feedbackEscapeHtml_(value || "Not provided"),
    '</td>',
    '</tr>',
    '</table>'
  ].join("");
}

function feedbackEmailDate_(value) {
  const text = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const parts = text.split("-").map(Number);
  const date = new Date(parts[0], parts[1] - 1, parts[2]);
  return Utilities.formatDate(date, FEEDBACK_CONFIG.timeZone, "d MMMM yyyy");
}

function sendFeedbackRecoveryNotification_(context, feedback, booking) {
  const settings = getFeedbackSettings_(context);
  const recipients = parseFeedbackEmails_([
    settings.SITE_EMAIL_ADDRESS,
    settings.FOLLOW_UP_RECIPIENTS
  ].filter(Boolean).join(","));
  if (!recipients.length) return;
  MailApp.sendEmail({
    to: recipients.join(","),
    subject: "Low hospitality feedback requires follow-up | " +
      context.site.siteName + " | " + feedback.bookingReference,
    body: [
      "A client has requested contact after leaving a low rating.",
      "",
      "Booking: " + feedback.bookingReference,
      "Company: " + (booking.clientCompany || ""),
      "Overall score: " + feedback.overallSatisfaction + "/5",
      "Preferred contact: " + feedback.preferredContactDetails,
      "Improvements: " + feedback.improvements,
      "Additional comments: " + feedback.additionalComments
    ].join("\n")
  });
}

function parseFeedbackEmails_(value) {
  const seen = {};
  return String(value || "").split(/[\s,;]+/)
    .map(function(email) { return email.trim(); })
    .filter(function(email) {
      const key = email.toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || seen[key]) return false;
      seen[key] = true;
      return true;
    });
}

function feedbackEscapeHtml_(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
