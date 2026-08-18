# RCoA Hospitality Booking Platform

Client-facing hospitality booking journey for the Royal College of Anaesthetists tender demonstration.

The application is a branded clone of the existing FIKA demo booking platform. It preserves the complete six-step flow, menu logic, browser draft saving, validation, pricing, dietary capture, direct dashboard write path, booking confirmation emails, and responsive behaviour.

## Integration

- Booking references use the `RCOA` prefix.
- Completed requests write directly to the existing demo dashboard spreadsheet and `Dashboard Data` tab.
- RCoA-specific settings and line items use separate tabs in the booking data spreadsheet.
- Booking confirmation emails are sent to the contact email entered with the request.
- Automated feedback emails are disabled for RCoA.
- The official RCoA logo, deep-purple palette, and Semplicita Pro typography are used throughout the interface and notification templates.

## Deployment

This is a Google Apps Script web application. The deployment executes as the owner and permits anonymous access so tender reviewers can complete the booking journey without signing into Google.
