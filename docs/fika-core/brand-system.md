# FIKA Core Brand System

## Purpose

The Brand System provides consistent, governed identity across FIKA OS experiences while allowing approved client brands, white-label arrangements, sites and future Events experiences to remain distinct.

Branding is presentation/configuration. It must not redefine domain rules, permissions, recipients, statuses or sources of truth.

## Brand hierarchy

1. **FIKA brand:** the primary organisational identity and default design language.
2. **Experience/domain brand:** an approved expression for a capability such as future Events.
3. **Client brand:** an approved client identity or co-brand relationship.
4. **Site override:** a narrowly scoped variation for a site where explicitly allowed.
5. **Application context:** selects approved brand/version and presentation mode; it does not invent brand values.

Precedence and allowed overrides are defined by each brand key. White-labelling must be an explicit brand relationship, not arbitrary removal of FIKA identity.

## Brand definition

A versioned conceptual brand definition may include:

- stable brand ID, name and status;
- relationship to parent/co-brand/white-label context;
- logo asset roles and usage rules;
- colour palette and semantic colour tokens;
- typography families, roles and fallback policy;
- spacing, shape, elevation and motion principles;
- imagery/art-direction guidance;
- tone of voice and content guidance;
- accessibility constraints;
- approved Media asset references;
- allowed site/application overrides;
- effective dates, owner and approval evidence.

It should reference assets rather than embed implementation-specific paths.

## Logos

Define roles such as primary, compact, mark, inverse and co-branded lockup. Each role may have approved variations/renditions, minimum size, clear space, background and accessibility guidance. Applications request a role; they do not select arbitrary files.

## Colour palettes

Separate foundational colours from semantic roles such as text, surface, action, success, warning, error and focus. Contrast requirements apply to every effective override. Site/client variations should map semantic roles rather than duplicate application styles.

## Typography

Define semantic text roles, hierarchy, weights, scale, line spacing and approved fallbacks. Typography choices must remain readable, responsive and available under the approved asset/licence policy.

## Assets

Brand records reference approved Media assets with version, purpose, rights and visibility. Asset replacement creates a governed version/relationship; it does not silently mutate historical generated documents where reproducibility matters.

## White-labelling and client brands

Each relationship must define:

- FIKA visibility and co-branding rules;
- which tokens/assets/content may be overridden;
- approval owner and effective period;
- accessibility and legal constraints;
- fallback when a client asset is missing/invalid;
- which generated documents/notifications use which brand.

Client branding must not cause a separate operational truth or fork shared workflows.

## Site overrides

Site overrides are permitted only for keys explicitly marked site-overridable. They require a reason, owner, validation and version. A site should normally select a brand and supply limited approved variations rather than copy the complete brand definition.

## Future Events branding

The internal Events capability and separate public experiences may use distinct brand presentations while sharing a canonical internal event model. Event brand architecture, co-branding and venue/client overrides require discovery. Presentation must not split event identity or lifecycle.

## Future Media Portal integration

A future Media Portal may supply approved asset discovery, rights, rendition and usage information through Media Service. Brand Service remains the authority for which asset role/version is valid in a context; Media Service owns asset metadata/content lifecycle.

## Governance and validation

- Brand owner approves definition and usage policy.
- Brand Service resolves effective versions and overrides.
- Media Service validates asset availability/rights/visibility.
- Validation checks completeness, token types, references, contrast and allowed overrides.
- Configuration selects brand context without exposing private configuration.
- Document and Notification Services record the brand version used for reproducibility.

## Open questions

- TODO: Confirm brand owners and approval process.
- TODO: Define initial FIKA tokens, logo roles, typography and accessibility target.
- TODO: Inventory approved client brands and white-label agreements.
- TODO: Define Events brand hierarchy and Media Portal ownership.
- TODO: Define asset licensing, retention and historical-rendering policy.
