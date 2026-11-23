# Cross-browser usability checks

The CI suite runs **Chromium, Firefox and WebKit** for desktop, plus mobile
Chromium and mobile WebKit. It checks known routes, dark-mode accessibility,
narrow-screen overflow, the skip link, Back/Forward navigation, and reduced
motion. These are simulated browsers; automated mobile WebKit is not identical
to a physical iPhone.

## Manual device spot-checks before a major release

- [ ] On iPhone Safari, focus each text field and verify the page doesn't zoom
      unexpectedly. Pinch zoom must remain available.
- [ ] On Android Chrome, check soft-keyboard input types and scroll-to-field
      behavior when forms exist.
- [ ] At 320 px, 390 px, landscape, and 200% browser text zoom, look for
      clipped or horizontally scrolling content.
- [ ] Use a keyboard only: skip link, visible focus, navigation, Escape and
      Back/Forward.
- [ ] Test the mobile menu and theme switch with touch and a screen reader.
- [ ] Try system dark mode, manually selected themes, reduced motion, and high
      contrast/forced colors where available.
- [ ] Check fixed-position interfaces against safe areas, virtual keyboards
      and dynamic browser toolbars when those interfaces are introduced.

## Performance

Desktop Lighthouse continues to enforce performance >= 0.75. A second mobile
Lighthouse profile enforces performance >= 0.60 as an initial, deliberately
conservative budget. Raise thresholds as real performance measurements become
available. Lighthouse's device emulation and synthetic throttling are only
proxies for actual user experience, not replacements for Core Web Vitals.
