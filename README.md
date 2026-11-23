# Made by Marcel

Personal frontend portfolio and **Angular engineering playground**. The published website is built with Angular 22, using strict TypeScript, feature-first organization and static prerendering for GitHub Pages.

## Getting started

Requires Node.js 24.15+ and npm.

```sh
npm ci
npm start
```

## Quality gates

| Script                 | Purpose                                         |
| ---------------------- | ----------------------------------------------- |
| `npm run build`        | Production build and static prerendering        |
| `npm run lint`         | TypeScript/Angular/template rules               |
| `npm run typecheck`    | Strict TypeScript checking                      |
| `npm run format:check` | Check formatting                                |
| `npm run test:unit`    | Angular TestBed + Vitest                        |
| `npm run test:e2e`     | Playwright desktop/mobile and axe accessibility |
| `npm run lighthouse`   | Lighthouse performance and quality budgets      |

For browser tests, install all browsers used by the Playwright matrix: `npx playwright install chromium firefox webkit`. Then run `npm run test:e2e`.

Read [engineering principles](docs/engineering-principles.md) and [architecture decisions](docs/decisions/0001-angular-static-site.md).

## Architecture

```text
src/app/
  core/theme/         Application-level theme state
  layout/             Site shell (header and footer)
  features/           Pages grouped by user-facing feature
  app.routes.ts       Lazy routes
  app.routes.server.ts Prerendering policy
```

No empty shared folders, store abstractions or state libraries are added until there is a use case. Feature tests live beside their implementation.

## The earlier parallax demo

The previous standalone SVG parallax homepage is preserved in `prototypes/parallax/index.html` as source material, not the deployed entry point. It can be converted into an Angular feature when the lab is ready.

## CI/CD

PRs into `main` must pass `Validate website`. Production builds deploy to GitHub Pages only after a successful `main` build. CodeQL and Dependabot remain enabled.

Angular prerenders to `dist/portfolio/browser`; GitHub Pages publishes that directory. The Pages deployment workflow publishes the statically prerendered Angular application after successful validation on `main`.
