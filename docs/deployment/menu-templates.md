# Menu output formats and site templates

Hospitality bookings and Delivered-In days produce a printable menu through one shared path
(`@fika/server-shared/menu-artifact`):

    workflow adapter -> NormalizedMenu
      + MenuOutputFormat  ("tablet" | "flat-label" | "tent-label")   chosen by the caller
      + SiteBranding      (colours, font, logical assets)             resolved from the site
      -> planMenuLayout()        layout masters (geometry) + fitting + pagination   [menu-formats.ts]
      -> Google Slides requests                                                    [menu-slides.ts]
      -> idempotent Drive publication                                              [menu-artifact.ts]

The renderer never branches on workflow. The **caller picks the format**; the **site picks the branding and Drive master deck**.

| Module (`packages/server-shared/src`) | Owns |
| --- | --- |
| `menu-types.ts` | `NormalizedMenu`, `MenuOutputFormat`, `MenuArtifactError` |
| `menu-allergens.ts` | allergen wording/safety rules (shared by every format) |
| `menu-validation.ts` | `assertNormalizedMenu` (also run inside the planner) |
| `menu-formats.ts` | `LAYOUT_MASTERS` (geometry), `SITE_BRANDING` (data), `planMenuLayout` |
| `menu-slides.ts` | plan -> Slides `batchUpdate`; reads the copied master deck, never hard-codes object ids |
| `menu-preview.ts` | offline HTML preview of a plan (review aid, not production) |
| `menu-artifact.ts` | identity, template resolution, Drive publication, public exports |

## Formats

| Format | Master deck | Output | Pagination |
| --- | --- | --- | --- |
| `tablet` | MNK Tablet Template (portrait 496.08 x 793.44pt) | one menu page; sections read Hot mains, Sides & extras, then Salads | none; overflow fails with `MENU_OVERFLOW` |
| `flat-label` | MNK Label Template **slide 2** (landscape 765.37 x 540pt) | one dish per 168.1 x 76.5pt label, 4 x 6 = 24 per page | automatic; pages are duplicated as needed |
| `tent-label` | MNK Label Template **slide 1** | one dish per fold-over card (168.1 x 153pt: rotated rear face + front face), 4 x 3 = 12 per page | automatic |

Only formats the supplied references show are implemented. The label reference deck turned out to contain both a tent
page and a flat page, so both exist; adding another format means adding a `LayoutMaster`, a `MenuOutputFormat` member and
a `formats` entry on the sites that support it.

### Where the geometry came from

All numbers are in `LAYOUT_MASTERS` with the extraction notes at the top of `menu-formats.ts`. Summary:

* **MNK Tablet Template** (Google Slides): page 6 300 200 x 10 076 675 EMU. Header art 0,0 496.9x139.9, accent rule y=139.9 h=3.8
  `#49A5B5`, footer bar y=748 h=45.7 `#0F4C6A`, MNK mark 32.8,63.4 88.8x29.3, "MENU" 34pt Montserrat white at 272.6,42.3
  188.9x71.4, footer Fika mark 22.7,762.4 and tagline 343.3,763.8. The template has no content box; the content region
  (35.4,155.9 425.2x568.3, the 2026-08-25 deck used Montserrat 15pt bold `#0F4D6B` dishes and 10pt red allergens; dishes are now 13pt with section titles at about 1.5x the dish size) is the proven region.
* **MNK Label Template.pptx**: page 9 720 250 x 6 858 000 EMU. Group transforms (scale 0.625) were composed to absolute origins; the
  source rows are not on a perfectly regular pitch, so origins are stored as extracted. Face: white, 0.72pt `#45C1B6` outline;
  bar: bottom 18.5pt `#134D6B` with the MNK mark bottom-left and the white Fika mark bottom-right; rear face (tent): `#134D6B` with the MNK mark rotated 180 degrees.
  Text typography follows the Hospitality hot-lunch label deck that uses the same cards (centred Montserrat bold, `#134D6B`, 7.65pt / 3.8pt insets).

## Configuring a site

Each branded Google Slides file is a **master deck** copied per artifact (Slides cannot ingest local bitmaps, so the logos live in the master).

| Site | Format | Setting |
| --- | --- | --- |
| MNK | `tablet` | `GOOGLE_MENU_TEMPLATE_ID_MNK` (legacy `GOOGLE_MENU_TEMPLATE_ID` honoured) = the **MNK Tablet Template** |
| MNK | `flat-label`, `tent-label` | `GOOGLE_MENU_LABEL_TEMPLATE_ID_MNK` = the **MNK Label Template** (one deck serves both) |
| One Angel Court | `tablet` | `GOOGLE_MENU_TEMPLATE_ID_ANGEL_COURT` |

Hospitality's per-site override (`googleMenuTemplateId`) applies to `tablet` only; a tablet deck is never used as a label master.
A site/format with no layout or an unconfigured deck fails with `MENU_FORMAT_UNSUPPORTED` / `MENU_TEMPLATE_NOT_CONFIGURED`; a master deck whose page
size or card grid does not match the layout master fails with `MENU_TEMPLATE_MISMATCH` instead of producing a misaligned sheet.

Hospitality dashboard: the booking panel shows a **Menu format** picker only when the site supports more than one format (`menuFormatsForSite`: MNK =
Tablet menu + Flat labels; Angel Court = tablet only, so no picker). **Tent labels are defined (`available: false`) but hidden and refused until a real tent
layout is approved.** `POST /api/menus` takes `format` (default `tablet`); the dashboard keeps one current output per booking per format and flags it
outdated when the CPU plan changes. Delivered-In: the same picker, fed by `GET /api/delivered-in/site-menu` (`formats`, `labels`).

Labels are **never auto-regenerated**. Delivered-In records each label format separately (own current record, `format` on the artifact) and `siteLabelState` flags it
**OUTDATED** when the day's content hash changes, a new CPU allergen release is published, or a release is revoked (revocation marks every format). Generating
labels never replaces or retires the tablet menu; a newer label revision retires only earlier files of the same source and format.

## Where generated menus are filed

    <existing menu parent>/Generated Menus/WC_<Monday of the service week>/<Slides file>

The parent is where menus already went: Hospitality - the site's configured menu folder, else the owner's configured root, else the `FIKA OS/Hospitality/Menus`
path; Delivered-In - the output folder (`GOOGLE_DELIVERED_IN_OUTPUT_FOLDER_ID` / app Drive root). This applies to the shared-template path and to the
generic Delivered-In template path. Folders are found-or-created (`ensureGeneratedMenusFolder`), so there are no duplicates. `WC_YYYY-MM-DD` is the existing
week-commencing convention.

## Adding a site

Add a `SITE_BRANDING` row (colours, font, logical assets, `formats` -> layout master + env keys). If the site has its own physical layout
add a `LayoutMaster`; if it reuses MNK's, reference the existing one. Colours never live in `LAYOUT_MASTERS`; geometry never lives in `SITE_BRANDING` (tested).

## Identity and retries

Artifact key inputs: site, date/time, workflow, source id, source version, revision stamp, **output format** and **layout template version**
(`mnk-flat-label-v1`). The Drive file carries it as `appProperties.fikaMenuArtifactKey` (plus `fikaMenuFormat`), so a retry reuses the file.
An amendment is a new key; earlier revisions of the **same source and same format** (`fikaMenuSourceKey` includes the format) are moved to the Drive
trash. Generating flat labels never retires the tablet menu. File names: tablet unchanged; labels add `-flat-labels` / `-tent-labels`.

Upgrade note: keys and source keys now include the format, so each existing tablet menu is regenerated once on its next generation
(the old file, which carries the old source key, is not auto-retired - same as files predating artifact keys).

## Allergen rules

* Allergens a dish contains print in brackets with no prefix, e.g. `(Gluten, Milk)`. "May contain" is **not displayed on any menu** (it stays in the data). A dish that only may-contain something, and a dish with no key allergens, print no allergen line (no text, no red).
* Machine keys are humanised (`tree_nuts` -> `Tree Nuts`).
* A dish with unrecorded allergens is refused (`MENU_ALLERGENS_UNRECORDED`); a dish with no allergens **and no positive "clear" evidence** is refused
  (`MENU_ALLERGENS_NOT_ESTABLISHED`). `noKeyAllergens` (derived from explicit clear/none states or the workflow's `no_key_allergens` marker) is still required for a dish with no allergens, but it prints nothing. Nothing is inferred.
* Minimum sizes: tablet 10pt dishes / 8pt allergens; labels 8pt dish names / 7pt allergens. Label dish names start at 10pt and shrink (to 8pt) only when a long name needs it. A menu or label that cannot fit fails with
  `MENU_OVERFLOW` / `MENU_LABEL_OVERFLOW`; allergens are never truncated, dropped or shrunk past the floor.

## Offline previews

`npx tsx packages/server-shared/tools/render-menu-samples.ts` writes HTML samples to `artifacts/menu-previews/` (git-ignored). Place the four brand PNGs
(`mnk-tablet-header`, `mnk-group-logo-white`, `fika-logo-white`, `fika-tagline-white`) in its `assets/` folder to see logos. Open the pages in a browser: each
reports whether every text box fits with the real Montserrat font.
