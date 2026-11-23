# Made by Marcel

A personal frontend portfolio built as a standalone HTML page, including an SVG parallax scene and a day/night palette. The existing artwork and interactions remain in `index.html`; build tooling does not transform it.

## Requirements

- Node.js 24 or newer
- npm

## Develop and test

```sh
npm install
npm run build
npm run serve
```

Visit http://127.0.0.1:4173.

| Command | Purpose |
| --- | --- |
| `npm run lint` | ESLint for tooling **and the inline page JavaScript** |
| `npm run format:check` | Verify formatting of tooling and docs (not the large generated SVG/HTML) |
| `npm run format` | Format tooling and docs |
| `npm run test:unit` | Node's built-in tests for static page invariants |
| `npm run test:e2e` | Playwright tests on desktop and mobile Chromium |
| `npm run lighthouse` | Lighthouse CI desktop audit; run after `npm run build` |
| `npm run build` | Copy `index.html` unchanged to `dist/` |

Install Chromium locally before the first E2E run:

```sh
npx playwright install chromium
```

## CI and deployment

PRs into `main` run JavaScript linting, formatting checks, Node tests, Playwright, axe accessibility checks, Lighthouse CI and CodeQL. The Pages deployment only runs on successful validation of `main`, never on a PR.

Once the CI workflow has been merged, set **Settings → Pages → Build and deployment → Source: GitHub Actions**. Then add a GitHub repository ruleset for `main` requiring pull requests and the **Validate website** status check (plus CodeQL if its checks are enabled). GitHub App access cannot administer branch protection or Pages settings from this integration.

Dependabot checks npm and GitHub Actions dependencies weekly. All automation uses GitHub Actions on the free public repository.

`index.html` is intentionally excluded from Prettier to avoid unintentionally reformatting or rewriting the original SVG. The JavaScript inside it **is** extracted temporarily and linted.

## Initial bootstrap

The first CI run temporarily uses `npm install` to generate a full `package-lock.json` in GitHub Actions. After the lockfile is committed, CI should use `npm ci` and the temporary export step should be removed.
