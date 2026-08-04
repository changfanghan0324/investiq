# InvestIQ Portfolio Readiness Baseline

**Recorded:** 2026-08-03

**Baseline commit:** `ff5a9549547664c5b6b8186f87e72f1f97cc518a`

**Review branch:** `codex/portfolio-readiness-v1`

**Production alias:** <https://investiq-eight-xi.vercel.app>

**Production deployment:** `dpl_HhJqaMC5VWrrGg44xEmNJN9aHUXi`

This document freezes the verified starting point for the recruiter-readiness work. It distinguishes observed behavior from planned changes so the final release can be audited against a concrete baseline.

## Executive baseline

InvestIQ already has a coherent four-area product shell, a substantial deterministic financial domain layer, bilingual English/Simplified Chinese UI, a working Vercel deployment, and a passing automated unit-test/build baseline. The primary release risk is not a broken application. It is inconsistent communication of evidence modes when licensed public market-price data is unavailable: some pages correctly show synthetic demonstrations, while the DCA page still exposes a live action that predictably fails.

The release work should therefore consolidate data truth and service readiness first, then improve recruiter-facing product hierarchy and evidence. Formula changes are out of scope unless an existing calculation fails a reproducible test and the change is separately reviewed.

## Verified repository state

| Check | Result | Evidence |
|---|---|---|
| Working tree | Clean at baseline | `git status --short --branch` |
| Git branch | `codex/portfolio-readiness-v1` | Created from `origin/main` |
| Local vs remote | Baseline SHA equals `origin/main` | `ff5a954…` |
| Node runtime required | `>=24 <25` | `package.json` and `.nvmrc` |
| Dependency install | Passed under Node 24.14.0 | `npm ci` |
| TypeScript | Passed | `npm run typecheck` through `npm run check` |
| ESLint | Passed | `npm run lint` through `npm run check` |
| Unit tests | 26 files, 586 tests passed | Vitest output from `npm run check` |
| Production build | Passed | Next.js 16.2.12 `npm run build` |
| Source inventory | 134 files under `src/` | Filesystem count |
| Latest GitHub CI | Passed | Run `30836284250` at baseline SHA |
| npm security audit | 0 critical, 0 high, 3 moderate | `npm audit --json` |

The three moderate audit findings share the PostCSS advisory inherited through the Next.js/Vite dependency graph. The repository pins `postcss` 8.5.19; the patched range begins at 8.5.23. This is a bounded dependency-hardening candidate, not evidence that the deployed site is currently compromised.

## Verified production state

The active Vercel deployment was created from the same baseline SHA and reports `READY`. No production error-log rows were returned for the inspected 24-hour window.

### Service readiness

`GET /api/health` intentionally returns HTTP 503 with a valid JSON readiness document:

```json
{
  "status": "unavailable",
  "services": {
    "priceAnalysis": "unavailable",
    "dca": "unavailable",
    "assistant": "ready",
    "database": "configured"
  }
}
```

This response means the public deployment is reachable but does not have a market-data entitlement suitable for public historical-price analysis. The browser must parse this valid 503 JSON as a service-state response rather than treating it as a generic network failure.

### SEC fundamentals

The production AAPL fundamentals endpoint returned HTTP 200 with Apple Inc. and 29 available metrics, with no unavailable metrics in the inspected response. The latest annual revenue evidence was FY2025, filed 2025-10-31, accession `0000320193-25-000079`. SEC fundamentals are therefore independently available even when licensed price analysis is unavailable.

### Route inventory

The production build exposes these user-facing pages:

- `/`
- `/company/[ticker]`
- `/company/[ticker]/financials`
- `/company/[ticker]/valuation`
- `/company/[ticker]/memo`
- `/company/[ticker]/report`
- `/compare`
- `/portfolio`
- `/tools`
- `/tools/dca`
- `/market`
- `/methodology`

Legacy `/stock` and `/dca` routes redirect to current destinations. Browser inspection found meaningful rendered content and no framework error page on the reviewed routes.

## Confirmed strengths

- Primary navigation already contains exactly Research, Compare, Portfolio, and Tools.
- Public market-data licensing is fail-closed; the implementation does not silently bypass the public license gate.
- Company analysis visibly separates SEC-derived fundamentals from market-price-dependent sections.
- The Market workspace provides a clearly labelled synthetic demonstration when live market history is unavailable.
- Existing financial calculations have broad unit coverage and deterministic behavior.
- DCF inputs and outputs use FCFF concepts and guard the `WACC > terminal growth` condition.
- Bilingual English and Simplified Chinese catalogs are substantial and the document language is updated when language changes.
- No high or critical npm vulnerability was reported at baseline.

## Confirmed release gaps

### P0 — data truth and service readiness

1. Service readiness is fetched and interpreted separately by several clients instead of through one typed source of truth.
2. The DCA page says the data service is degraded but still leaves **Run live backtest** enabled. That action predictably produces an unavailable response.
3. Readiness requests do not consistently use an abort timeout, shared cache, or one failure-safe parser.
4. The DCA live/demo action hierarchy does not adapt to service readiness, even though a deterministic demonstration is already rendered.
5. Assistant availability and report availability are not communicated independently enough in action controls.

### P1 — recruiter-facing product clarity

1. The homepage lacks a permanent public-demo disclosure explaining real SEC fundamentals versus synthetic market-price examples.
2. The featured AAPL entry leads to a live company route rather than a stable, reviewable case study.
3. The homepage does not identify the project owner or provide a verified portfolio contact surface.
4. There is no dedicated `/about` page or `/case-study/aapl` page.
5. The Tools page includes a planned Growth Calculators card that weakens the research-and-portfolio positioning.
6. Text-size controls display internal storage values (25/50/75/100) instead of user-facing scale labels (100/115/130/145).

### P1 — automated evidence

1. There is no Playwright end-to-end suite.
2. There is no automated axe accessibility check.
3. CI runs unit/static/build checks but not deterministic browser flows.
4. The required seven-state public-mode matrix is not directly exercised at the UI boundary.

### P2 — documentation and presentation

1. The English README is too long for recruiter-first scanning and mixes overview with deep implementation detail.
2. The repository lacks a curated screenshot set, concise demo script, project summary, and verified usability-test record.
3. Documentation assets are not yet organized into clear public, historical, design, sample, and internal groups.
4. No license has been selected; public release implications need an explicit owner decision.

### P2 — bounded hardening and UX

1. Browser storage reads/writes are not consistently protected against unavailable or blocked `localStorage`.
2. Security headers have not been explicitly configured and tested.
3. DCA holdings are currently unlimited even though the release rule is 1–10 unique holdings.
4. The current production bundle has not yet been measured route-by-route; the built `.next` directory is approximately 640 MB including server/build artifacts, which is not equivalent to client transfer size.
5. Mobile, keyboard, reduced-motion, and print/PDF behavior still need structured verification.

## Public identity inputs

| Item | Baseline decision |
|---|---|
| Public name | Fang Han Chang (Peter Chang) |
| Background line | Finance background; incoming Boston University MSBA student |
| GitHub | Verified repository owner: <https://github.com/changfanghan0324> |
| LinkedIn | Not yet verified; do not publish a guessed URL |
| Public contact email | Not yet approved for portfolio display; do not repurpose service/User-Agent addresses |
| License | No repository license found; record the decision before adding one |

## Baseline screenshots and observations

The baseline was inspected in the deployed application rather than from mockups alone:

- Home: functional four-item navigation, bilingual controls, featured AAPL entry, and four capability cards; missing public-demo and owner disclosures.
- Tools: two usable tools plus one planned Growth Calculators card.
- DCA: deterministic demo report loads, but the unavailable live action remains enabled and leads users toward a known failure.
- Company: SEC fundamentals load independently; price-dependent analysis remains explicitly unavailable.
- Compare and Portfolio: demonstration states render without a framework crash.

Portfolio-ready screenshots will be captured only after the target UI and evidence-state behavior are complete, to avoid presenting this baseline as the finished product.

## Acceptance baseline for the final diff

The final release candidate must, at minimum:

1. Preserve the public market-data license gate and all documented finance invariants.
2. Make data mode and service readiness consistent across user-visible workflows.
3. Prevent unavailable live actions while preserving user inputs and offering deterministic demo evidence.
4. Provide a recruiter-readable home, about page, and stable AAPL case study.
5. Pass static checks, unit tests, production build, deterministic Playwright flows, and axe checks.
6. Prove the 1–10 DCA holding rule at UI, domain/service, tests, docs, and export surfaces.
7. Publish only verified usability results, screenshots, identity links, and data-source claims.
8. Finish on a reviewable pull request without merging it automatically.

## Deferred owner decisions

- Verify a LinkedIn URL if it should appear publicly.
- Approve a public contact email, if desired.
- Choose a repository license or intentionally remain all-rights-reserved; see the forthcoming license decision note.
- Supply real usability participants if measured participant-based claims should appear in the final portfolio release.
