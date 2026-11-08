# CPU run sheet print dialog: visual review

**Status:** fixture-only layout approved by owner; implementation complete
**Issue:** #142
**Fixture data:** synthetic order counts and destination names; no production data loaded

## Comparison

The current dialog is a narrow, single-column form. Dates, destinations, a short selection summary, and the print action follow one another vertically. It has no service filter or per-destination service controls, so an operator cannot exclude one service at one OPLOC while retaining another.

The proposal uses a wider two-column desktop layout. The left column groups date and A4 choices, service filters, and searchable destinations into numbered sections. The right column keeps the live selection summary and print action together. Each destination shows service-level toggles, making a choice such as MNK Grab & Go without MNK Hospitality visible and explicit. The summary describes selected dates, service scope, destinations, eligible orders, and a conservative sheet estimate; final pagination remains content-dependent.

At tablet and mobile widths the content stacks into one column. On mobile the print and cancel actions remain pinned at the bottom, while the summary remains in the document flow so it can be reviewed by scrolling. The screenshots were checked at 1440×1000, 900×1024, and 390×844; the fixture page had no horizontal overflow at those widths.

This mockup only demonstrates layout and synthetic content. Its controls are not connected to production orders or the print engine. The owner approved this layout in chat before implementation began.

## Screenshots

| Viewport | Existing dialog | Proposed dialog |
| --- | --- | --- |
| Desktop, 1440×1000 | [desktop-before.png](evidence/desktop-before.png) | [desktop-after.png](evidence/desktop-after.png) |
| Tablet, 900×1024 | [tablet-before.png](evidence/tablet-before.png) | [tablet-after.png](evidence/tablet-after.png) |
| Mobile, 390×844 | [mobile-before.png](evidence/mobile-before.png) | [mobile-after.png](evidence/mobile-after.png) |

The full mobile print summary is shown in [mobile-after-summary.png](evidence/mobile-after-summary.png).

## Review points

- Confirm the four-section hierarchy and desktop two-column balance.
- Confirm the distinction between canonical OPLOC destinations and order-scoped address snapshots.
- Confirm that per-OPLOC service toggles and the summary make exclusions clear enough before printing.
- Confirm compact versus full-width A4 as the right layout choice labels.
