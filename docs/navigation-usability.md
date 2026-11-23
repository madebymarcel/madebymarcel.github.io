# Navigation behavior

- The mobile navigation is a disclosure, not a modal dialog: no focus trap or
  scroll lock is required.
- The menu button exposes its expanded state and controls a real navigation region.
- Escape closes it and returns focus to the menu button. Selecting a link or
  clicking outside closes the menu.
- On client-side route changes, focus moves to the new H1. On initial page
  load, focus stays where the browser puts it.
- Unknown URLs render a real 404 route, not a silent home redirect.
- Because GitHub Pages is a static host, the build copies the prerendered
  `/404/` page to `404.html`. This allows direct unknown URLs to hydrate
  with matching not-found content.
- Use native links for navigation so opening new tabs, Back/Forward, and
  keyboard activation remain available.
