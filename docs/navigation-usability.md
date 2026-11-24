# Navigation behavior

- Reserve a stable root scrollbar gutter to avoid navigation shifts between routes.
- Mobile navigation opens a native modal dialog as a right-hand drawer with a
  translucent backdrop. Background content is inert and scrolling is locked.
- The menu button exposes its expanded state and controls the dialog. Escape,
  the close button and backdrop clicks dismiss it and restore focus. Selecting
  a link or resizing to desktop closes the drawer.
- On client-side route changes, focus moves to the new H1. On initial page
  load, focus stays where the browser puts it.
- Unknown URLs render a real 404 route, not a silent home redirect.
- Because GitHub Pages is a static host, the build copies the prerendered
  `/404/` page to `404.html`. This allows direct unknown URLs to hydrate
  with matching not-found content.
- Use native links for navigation so opening new tabs, Back/Forward, and
  keyboard activation remain available.
