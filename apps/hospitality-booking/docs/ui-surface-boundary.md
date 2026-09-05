# Hospitality UI surface boundary

Hospitality contains two intentionally different visual systems. The
`data-surface` marker is the audit-friendly boundary between them.

| Surface | Production routes/components | Ownership |
| --- | --- | --- |
| FIKA internal operational | `/manage`, `/dashboard`, `/workspace`, `/hospitality/manage`; `HospitalityWorkspace`; `HospitalityDashboard`; calendar, booking queue, settings, run-sheet, amendment and inbox-scan workflows | FIKA OS shell, operational semantics and interaction safety |
| Client-branded customer portal | `/mnk`, `/angel-court`, `/cfc`, `/munich-re` and their compatibility portal routes; `BookingPortal` | Approved client logo, palette and font variants, scoped by `site-mnk`, `site-angel-court`, `site-cfc` or `site-munich-re` |
| Shared / neutral | `portal-sites.ts`, typed booking contracts, API routes, document generation and neutral validation/progress primitives | Shared contracts and neutral behaviour; visual ownership follows the containing surface |

## Token ownership

`shared/fika/tokens.css` is imported by the Hospitality root layout. Internal
dashboard chrome consumes the shared `--fika-*` semantic layer through the
scoped aliases in `HospitalityDashboard.module.css`. The selected portal class
may remain on the dashboard for site context, but it cannot replace the FIKA
operational aliases.

Client overrides remain in `app/globals.css` and are explicitly scoped below a
client surface selector. They preserve approved client branding and assets;
they are not an instruction to restyle the portal as FIKA.

Accessibility and interaction safety override both systems: WCAG contrast,
visible `:focus-visible`, labelled controls, keyboard access, text-plus-colour
status meaning, and non-dismissible committed-write progress states apply to
every surface. Native `alert`, `confirm` and `prompt` are prohibited in
user-facing workflows.

The existing Hospitality amendment progress modal is the local reference for
long-running operations: it prevents duplicate submission, exposes named
stages and current detail, shows meaningful progress, reports success/failure,
and cannot be dismissed while the committed operation is running.
