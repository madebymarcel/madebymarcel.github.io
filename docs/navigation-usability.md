# Navigation behavior

- Reserve a stable root scrollbar gutter to avoid navigation shifts between routes.
- Mobile navigation opens a nonmodal native dialog below the header. The drawer
  slides and fades in both directions over 0.6s with quartic easing, pushing the
  content and footer left without dimming them. Background content is inert and
  scrolling is locked while the header remains usable.
- One header button controls the dialog and exposes its expanded state. Its icon
  and label animate between Menu and Close. Focus stays on the button when opening;
  Tab moves into the drawer. Escape, the toggle and clicks on the exposed page
  dismiss it and restore focus. Selecting a link or resizing to desktop closes it.
- The drawer follows the header's lower edge on opening and resizing, and respects
  reduced-motion preferences.
- On client-side route changes, focus moves to the new H1. On initial page
  load, focus stays where the browser puts it.
- Unknown URLs render a real 404 route, not a silent home redirect.
- Because GitHub Pages is a static host, the build copies the prerendered
  `/404/` page to `404.html`. This allows direct unknown URLs to hydrate
  with matching not-found content.
- Use native links for navigation so opening new tabs, Back/Forward, and
  keyboard activation remain available.
