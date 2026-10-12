# Strique mark provenance

- Source in the supplied brand kit: `Strique Brand Stuff/logos-variation/svg/favicon.svg`
- SHA-256: `34d90b60ab0146c62fbb9339a17e64d063c31480321d03cc204352077924571c`
- Vendored as: `assets/strique-icon.svg`
- Brand authority in the supplied kit: `Strique Brand Stuff/DESIGN-v2.md`, lines 380-386. Those lines identify this file as the standalone mark, require the official proportions, set a 24px minimum digital mark height, and set a 28px minimum wordmark height.

The vendored file is byte-identical to the official source. Do not optimize, recolor, or rewrite it without updating the source review, hash, and exact-byte tests.

## Theme-specific vector lettering

The official source kit is `Strique Brand Stuff/logos-variation/svg/`:

- `dark.svg` has dark ink for light backgrounds, vendored unchanged as `strique-logo-light.svg`.
- `light.svg` has white ink for dark backgrounds, vendored unchanged as `strique-logo-dark.svg`.

The Client frames the lettering with `viewBox="76 15 214 66"` because Harness supplies separate mark and name Slots. The original vector paths, ink colors, and transparent backgrounds are retained. The name viewport is 28px high and follows the active Harness theme attribute, including explicit theme overrides and System mode. No raster image, recoloring, filter, or mask is used.

- `strique-logo-light.svg` SHA-256: `995d9bb394b86ff0d0fd10c79758bed7c406282adcbf893d3e2134f4f838522d`
- `strique-logo-dark.svg` SHA-256: `d03ca5dc28abd73b9270df27d502cfe4270d9f2608f5570b71bb5741c865a0af`

`strique-favicon.svg` preserves the four official purple paths on a centered 80×80 canvas. The in-app mark remains byte-identical to the official standalone asset.
