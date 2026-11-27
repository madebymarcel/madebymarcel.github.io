# Change-based CI validation

The required **Validate website** check always runs lint, type checking, formatting,
all unit tests, a production build, and browser smoke checks. It never relies on
GitHub path filters to skip the required job.

For pull requests, the changed paths are taken from the PR base SHA to the actual
checked-out merge result. For pushes to main, the comparison starts at the prior
push SHA. Both paths of a rename are included. Missing, shallow or unrelated history,
unknown paths, shared code, global styles, configuration, dependencies and an
unmapped browser test inventory all select the full suite.

The feature-to-test map lives in `scripts/test-impact.mjs`. It includes cross-page
tests that exercise the selected feature. For example, changing T. rex runs its own
tests and accessibility checks; changing the project catalogue also runs the biped
and T. rex entry-link tests. A static import-boundary check falls back to full
validation if a shared module or another feature imports a feature's code.
This is conservative directory-based impact analysis with a static dependency guard,
not a complete dynamic dependency graph. Keep the map current as routes and test
dependencies change. New browser suites cause full validation until mapped.

All selected suites still run on all five existing browser/device projects.
The smoke suite opens every prerendered route, and the existing site navigation
and theme smoke tests also always run. Documentation-only changes run these smoke
tests, not the feature suites. Local `npm run test:e2e` remains the full suite.
CI reuses the production build for Playwright instead of rebuilding.

Both Lighthouse profiles currently audit the homepage, so they run for homepage
changes and all full-validation runs. They are deferred for isolated non-home
feature changes. The CI summary records the exact selected suites and audit mode.

A scheduled run at 02:23 UTC executes all browser suites, Lighthouse profiles,
and other validation without deployment. Manual workflow dispatch also runs the
full validation suite; dispatch on main retains the existing deployment behavior.
Scheduled validation has its own concurrency group, so it does not cancel or get
cancelled by a normal push to main.

The protected main branch still requires **Validate website**. Main pushes validate
their own change set before publishing. No test, browser, assertion or Lighthouse
threshold has been removed. To force full validation manually, run the workflow
from GitHub Actions. The first PR introducing this configuration intentionally
triggers full validation because CI and test infrastructure have changed.
