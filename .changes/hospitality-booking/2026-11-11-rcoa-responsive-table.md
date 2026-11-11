# 2026-11-11 — RCoA responsive booking list

The customer-facing table now keeps readable column widths on wide desktop displays and switches to the existing booking cards before narrow desktop widths can squeeze date/time and status columns together. The breakpoint is limited to the RCoA surface; Gallagher keeps its existing layout.

Validation: `fika validate` passed 163 workflow tests, 450 Hospitality tests, typecheck, and production build. Authenticated staging viewport UAT follows the merged staging deployment.
Deployment: pending governed Hospitality staging redeploy; production unchanged.

Style Guide compliance: PASS — uses the existing RCoA card pattern and shared semantic tokens.
