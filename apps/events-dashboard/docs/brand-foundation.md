# FIKA OS brand foundation

The Events Dashboard uses a small, reusable interface foundation derived from the approved source assets in `C:\FIKA\assets`. It establishes a consistent FIKA OS visual language without changing Event behaviour or introducing a separate component library prematurely.

## Authoritative sources

- `Fika Brand Guidelines v1.0 (1).pdf`
- `logos/fika_logo_white_png.png`
- `fonts/VimSM.otf`
- `fonts/GILROY-REGULAR.TTF`
- `fonts/GILROY-MEDIUM.TTF`
- `fonts/GILROY-SEMIBOLD.TTF`
- `fonts/GILROY-BOLD.TTF`

The logo and fonts copied into `public/` remain unchanged source artefacts. The interface does not redraw, distort or recolour the FIKA logo.

## Foundation files

- `app/styles/fika-tokens.css` defines brand, semantic colour, typography, spacing, radius, shadow and layout tokens.
- `app/globals.css` consumes those tokens for the Events Dashboard interface.
- `app/layout.tsx` loads the tokens before the application styles.

Future FIKA OS applications may adopt the same semantic token names. A shared package should be introduced only when more than one active application needs the foundation and the extraction can preserve application independence.

## Typography

- Vim Heavy is the display face for prominent, short headlines.
- Gilroy is the working interface face for labels, fields, body copy, navigation and operational data.
- System fallbacks keep the interface usable if a font cannot load.

The interface keeps display copy concise and uses more restrained Gilroy weights for dense operational views.

## Colour

FIKA Purple is the lead brand colour. White, warm neutral surfaces and dark text provide the working canvas. The secondary orange, yellow, turquoise, green and dark-purple colours are used sparingly and semantically; they are not decorative substitutes for the primary brand colour.

Status and feedback colours are expressed through semantic tokens so meaning does not depend on a raw brand colour name. Text, icons and labels accompany colour-coded states.

## Logo use

The approved white FIKA logo appears on the purple application header. Its rendered height exceeds the brand guideline's 20-pixel screen minimum, and surrounding space protects its visual clear area. “OS” is separate live text and is not incorporated into or drawn over the logo asset.

The supplied assets do not include an approved compact FIKA mark suitable for a favicon or application icon. No replacement has been invented. Favicon and installable-app icon treatment remain a brand decision.

## Accessibility and responsive behaviour

- Semantic text and surface tokens are chosen for readable contrast.
- Interactive controls have visible keyboard focus.
- Primary touch targets are at least 44 pixels high.
- Statuses are communicated with words as well as colour.
- Filters can collapse on smaller screens.
- The schedule and editor reflow for tablet and mobile widths.
- Reduced-motion preferences are respected.

## Known brand ambiguities

- TODO: Confirm an approved compact logo or icon for browser tabs and installable application use.
- TODO: Confirm whether a standalone purple FIKA logo without the slogan should be supplied for use on light surfaces.
- TODO: Confirm whether this foundation should become a shared package after another FIKA OS application adopts it.
