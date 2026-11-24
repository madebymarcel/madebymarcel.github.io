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
- Fibonacci spacing uses 3, 5, 8, 13, 21, 34, 55 and 89 CSS pixels at the default
  root size, expressed in rem so user font preferences are respected.
- Typography interpolates between a 1.25 modular scale at 320px and a golden
  ratio scale at 1280px with CSS clamp. Body text remains stable at 1rem.
- Golden-ratio columns are a composition option, not a requirement. Reflow,
  content length and accessibility take precedence.
- Radius, focus, minimum target size, motion, elevation and layout widths use
  named tokens. The water illustration retains its separate artistic values.

## Architecture

Tokens live in `src/design-system/_tokens.scss`. Global native component styles
live in `src/design-system/_components.scss`. Prefer semantic and component
tokens over raw palette values. Extend a shared style only where actual reuse
exists. The existing Angular theme service controls the theme.

The Lab route is the living catalogue: colors, spacing, typography, composition,
buttons, fields, feedback and states. Existing navigation, typography, footer,
skip link and page layouts consume the foundation. The WebGL shader is unchanged.

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
token scales, contrast, reflow and example interactions. The existing Axe,
ESLint, Prettier, type checking, build, browser and Lighthouse checks remain
in place. Establish visual screenshot baselines only after reviewing the
rendered design on supported browsers.
