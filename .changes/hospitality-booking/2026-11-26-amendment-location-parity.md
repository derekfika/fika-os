# 2026-11-26 — Keep staff amendment location fields separate

Staff amending a standalone Angel Court or MNK booking can edit its floor, room or area, and delivery point independently. Each field opens with its saved value and stays blank when the historical booking has no value for it. Editing a location preserves the booking's site and delivery destination.

Validation: 24 focused Hospitality component, DTO and adjacent booking tests passed. The Hospitality typecheck and production build passed. Authenticated staging acceptance is pending.

Deployment: none.
