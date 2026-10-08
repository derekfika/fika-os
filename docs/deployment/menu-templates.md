# Site menu templates

Hospitality bookings and Delivered-In days produce a printable menu through one shared path
(`@fika/server-shared/menu-artifact`):

    workflow adapter -> NormalizedMenu -> resolveMenuTemplate(site) -> layout -> Google Slides -> Drive

The renderer never branches on workflow. The **site** picks the template.

## Configuring a site template

Each template is an approved Google Slides file that is copied per menu. Set the template ID (or a pasted Slides URL)
in the app's runtime configuration:

| Site | Setting | Used by |
| --- | --- | --- |
| MNK | `GOOGLE_MENU_TEMPLATE_ID_MNK` (legacy `GOOGLE_MENU_TEMPLATE_ID` still honoured) | Hospitality, Delivered-In |
| One Angel Court | `GOOGLE_MENU_TEMPLATE_ID_ANGEL_COURT` | Hospitality |

Hospitality may also override the template per site dashboard in Hospitality settings (`googleMenuTemplateId`).
Delivered-In additionally needs its output folder (`GOOGLE_DELIVERED_IN_OUTPUT_FOLDER_ID` or the app Drive root).

A site with no template, or a template that is not configured, **fails with an actionable error**
(`MENU_TEMPLATE_SITE_UNSUPPORTED` / `MENU_TEMPLATE_NOT_CONFIGURED`); it never produces an unbranded or wrongly branded file.
Before this change an unconfigured Hospitality template silently returned no Slides file and the UI fell back to an
unbranded print sheet - that was why menu generation appeared to have stopped working.

Delivered-In sites that have no site template (everything except MNK today) keep using the generic Delivered-In template
(`GOOGLE_DELIVERED_IN_TEMPLATE_ID`) unchanged.

## Adding a site

Add one row to `TEMPLATE_FAMILIES` in `packages/server-shared/src/menu-artifact.ts` (site key, governed OPLOC id, env keys, page geometry
and typography) and set its template ID. The MNK geometry is the proven baseline from the 2026-08-25 deck.

## Identity and retries

Each menu has a deterministic artifact key (site, date/time, source, source version, revision stamp, template). The Drive file carries it as
`appProperties.fikaMenuArtifactKey`, so a retry reuses the file instead of copying the template again. An amendment is a new key; the earlier
revisions of the same source (`fikaMenuSourceKey`) are moved to the Drive trash so they cannot look current. Files generated before this change carry no
keys and are not retired automatically.

## Allergen rules

Allergens come from the owning workflow's canonical data (CPU plan / published day). Both "contains" and "may contain" are printed. A dish with
unrecorded allergens, or unconfirmed evidence, blocks the menu. Text never shrinks below 10pt (dishes) / 8pt (allergens); a menu that cannot fit fails
with `MENU_OVERFLOW` instead of clipping.
