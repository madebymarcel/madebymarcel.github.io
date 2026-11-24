# Made by Marcel design system

## Principles

Mathematical, accessible, fluid and enforceable. This is a small in-house system,
not an implementation of NL Design System or an import of a third-party UI kit.
NL Design System informs token architecture and accessibility practice; Utopia
informs fluid sizing. Prefer native HTML before adding interaction libraries.

## Foundations

- Primitive colors use OKLCH for perceptually consistent palette development.
  Semantic roles map to distinct light and dark values. OKLCH itself does not
  guarantee WCAG contrast. The theme-color metadata uses the equivalent existing
  hexadecimal colors for early page initialization.
- Fibonacci spacing uses 3, 5, 8, 13, 21, 34, 55, 89 and 144 CSS pixels at the default
  root size, expressed in rem so user font preferences are respected.
  Fluid space pairs interpolate between two Fibonacci values from 320px to
  1280px. Fixed tokens remain available for small controls and geometry.
- Typography interpolates between a 1.25 modular scale at 320px and a golden
  ratio scale at 1280px with CSS clamp. Body text remains stable at 1rem.
- Golden-ratio columns are a composition option, not a requirement. Reflow,
  content length and accessibility take precedence.
- Radius, focus, minimum target size, motion, elevation and layout widths use
  named tokens. The water illustration retains its separate artistic values.

## Architecture

Tokens live in `src/design-system/_tokens.scss`. Global native component styles
live in `src/design-system/_components.scss`. Prefer semantic and component
tokens over raw palette values. Responsive layouts live in
`src/design-system/_layouts.scss`. Extend a shared style only where actual reuse
exists. The existing Angular theme service controls the theme.

The Lab route is the living catalogue: colors, spacing, typography, composition,
buttons, fields, feedback and states. Existing navigation, typography, footer,
skip link and page layouts consume the foundation. The WebGL shader is unchanged.

## Fluid responsiveness

Use fluid values for dimensions, intrinsic layouts for composition, and
breakpoints for structural changes. The generated space pairs are:

| Role          | Minimum | Maximum |
| ------------- | ------: | ------: |
| Small gap     |     5px |     8px |
| Component gap |     8px |    13px |
| Stack gap     |    13px |    21px |
| Card padding  |    13px |    34px |
| Page gutter   |    21px |    34px |
| Section space |    34px |    89px |
| Hero space    |    55px |   144px |

The figures assume a 16px root font. CSS clamp provides continuous scaling
without resize handlers. Body font size, minimum control size and focus rings
retain their own accessible defaults.

Use `ds-stack` and `ds-cluster` for vertical and wrapping horizontal groups,
`ds-grid` for an intrinsic grid with an optional `--grid-min` column minimum,
and `ds-layout-context` around `ds-golden-split` for a proportional layout.
The split uses a container query at 36rem, falling back to a single column.
Use `ds-measure` to limit prose width.

The single configuration in `scripts/generate-design-scales.mjs` defines the
viewport endpoints, Fibonacci values, space pairs and type ratios. Run
`npm run design:generate` after changing it. Both the CSS scales and Lab
metadata are generated; CI rejects stale or manually edited generated files.

See [Utopia's fluid space calculator](https://utopia.fyi/space/calculator/)
for the inspiration behind space pairs.

## Accessibility and definition of done

Target WCAG 2.2 AA, with a preferred minimum 44px touch target for controls.
Check text contrast (4.5:1 for normal text, 3:1 for large text), meaningful
non-text contrast (3:1), keyboard use, visible focus, accessible names and
errors, reflow at 320 CSS pixels, 200% text resizing, reduced motion, and both
themes. Native controls retain their semantics.

A component is ready when applicable states and themes are implemented, its
responsive behavior and keyboard interaction are tested, usage is documented,
and automated checks pass. Manual assistive-technology and visual review are
still needed; automated tests alone cannot establish conformance.

## Enforcement

The existing lint command rejects raw hexadecimal and CSS color-function
literals in SCSS outside the token file. This focused guard does not parse
arbitrary inline styles or enforce every spacing decision. Playwright checks
token scales, contrast, reflow, container behavior and example interactions. The existing Axe,
ESLint, Prettier, type checking, build, browser and Lighthouse checks remain
in place. Establish visual screenshot baselines only after reviewing the
rendered design on supported browsers.
