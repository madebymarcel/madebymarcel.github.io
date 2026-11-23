# ADR 0001: Angular 22 with a statically prerendered portfolio

**Status:** Accepted for the foundation PR

## Context

This site serves two purposes: a professional portfolio and a demonstration of maintainable Angular engineering. Hosting is GitHub Pages, which cannot run an application server.

## Decision

- Use Angular 22 with standalone components, lazy feature routes and strict TypeScript.
- Follow Angular's feature-first style guide and colocate component tests.
- Use signals for local synchronous state and the Angular router for navigation.
- Prerender all known routes using `outputMode: "static"` and deploy `dist/portfolio/browser` on GitHub Pages.
- Keep the original parallax prototype in `prototypes/parallax/` until deliberately rebuilt as a feature.
- Reuse the existing GitHub Actions quality gate and its `Validate website` check name.

## Consequences

- Every public route is independently serveable as static HTML and can be indexed.
- Browser-only APIs must be guarded to keep prerendering safe.
- New public routes must be added to both client and server route definitions.
- The build needs newer Node.js and TypeScript than the previous plain-HTML prototype.
- We are intentionally **not** introducing NgRx, a monorepo, custom state abstractions or a UI kit before they are useful.

## Revisit when

A route requires server data, significant shared state, or a stronger accessibility/component system.
