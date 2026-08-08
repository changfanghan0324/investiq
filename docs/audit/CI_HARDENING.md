# CI/CD hardening

**Review date:** 2026-08-08

## Problem

The previous workflow ran typecheck, lint, unit tests, build, Playwright installation, and browser
tests in one job. It triggered on both every branch push and every pull request, which created two
identical runs for a pull request. When a shared runner was queued, those duplicates could be
cancelled without a useful product signal.

## New workflow contract

`.github/workflows/ci.yml` now has two independent jobs:

| Job | Checks | Timeout |
| --- | --- | --- |
| `quality` | typecheck, lint, unit/domain tests, production build | 15 minutes |
| `browser` | Chromium install, Playwright flows, accessibility checks, failure artifacts | 15 minutes |

Both jobs use the pinned checkout/setup-node actions, the repository `.nvmrc`, npm cache, and
`npm ci --no-audit --no-fund`. They run in parallel because browser verification does not depend on a
successful build job; each failure is independently actionable.

## Duplicate-run and concurrency policy

- Pull requests run only for `opened`, `synchronize`, and `reopened` events.
- Push runs are limited to `main`; feature branch pushes therefore do not create a second run next
  to the pull-request run.
- The concurrency key uses the pull-request number when available and the branch ref otherwise.
  A newer commit cancels only its older in-flight run.

## Browser diagnostics

The browser job uploads `playwright-report/` and `test-results/` when the job is not cancelled. This
keeps traces/screenshots available for real failures without making generated artifacts part of the
repository.

## Acceptance

The release PR must show both `quality` and `browser` jobs green on the same commit SHA. A cancelled
run is not treated as a pass. The production promotion check must separately confirm that Vercel's
deployed SHA equals the reviewed merge SHA.
