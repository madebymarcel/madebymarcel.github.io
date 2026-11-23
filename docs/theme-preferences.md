# Theme preference behavior

1. The default is the current operating-system color scheme.
2. If a visitor selects a theme, store `light` or `dark` in
   `madebymarcel-theme`. The explicit selection takes precedence.
3. If there is no manual selection, respond to future OS theme changes.
4. An inline script in the document head sets the initial theme before
   external stylesheets and Angular boot. This prevents wrong-theme flashes,
   including on statically prerendered pages.
5. Keep the CSS `color-scheme` and browser `theme-color` metadata in sync.
6. Gracefully handle private browsing contexts where storage access fails.

The initialization code is intentionally tiny because the first paint must
happen before the Angular application runs. The service owns subsequent
state, listeners and persistence. The existing visible `Dark mode` button is
a toggle whose pressed state exposes the current choice.

The page remains compatible with GitHub Pages prerendering and hydration.
