# FIKA OS Hospitality Booking

The MNK pilot is a new React/Next.js customer booking portal and internal Hospitality Dashboard. It uses the shared Firebase-backed Canon through typed Integration Hub contracts. It does not call Apps Script, Sheets, Calendar, Gmail or CPU.

## Local setup

1. Start the Integration Hub and its local Firebase emulator.
2. Copy `.env.example` to `.env.local` and set the same local-only bridge token in the Integration Hub environment.
3. Add governed active `Hospitality Menu Item` records with explicit `mnk-booking-platform` source mappings before submitting customer requests.
4. Run `npm run dev` and open the portal on port 3300. The internal Dashboard is at `/dashboard` and uses the authenticated local Hub identity.

The legacy MNK Apps Script portal and dashboard remain separate, live reference systems during parallel testing.
