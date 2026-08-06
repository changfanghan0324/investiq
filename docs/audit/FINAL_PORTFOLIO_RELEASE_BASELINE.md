# InvestIQ Final Portfolio Release Baseline

**Recorded:** 2026-08-04

**Baseline commit:** `9c55c0ceb6bc816a87753138f3ee4e174a0090c1`

**Baseline source:** `origin/main` at the same SHA

**Working branch:** `codex/final-portfolio-release-readiness`

**Production alias:** <https://investiq-eight-xi.vercel.app/>

**Production deployment:** `5753992558`, built from the baseline SHA

This document freezes the observed starting point for the final recruiter-facing release-readiness pass. It records evidence, gaps, and owner decisions before implementation. It does not claim that a release, tag, or merge has occurred.

## Product goal and release boundary

InvestIQ should present one coherent, auditable investment-research portfolio product: real SEC filing evidence for company fundamentals; deterministic, explicitly synthetic market examples in the public demo; and no implication that synthetic series are actual AAPL, MSFT, SPY, or other market history.

This pass may improve evidence architecture, copy, presentation, documentation, accessibility, tests, and release packaging. It must not add finance features, change finance formulas without a reproducible failing contract, bypass market-data licensing, fabricate sources or usability results, merge `main`, tag a release, or publish a final v1 release.

## Repository and delivery baseline

| Check | Observed result | Evidence |
|---|---|---|
| Baseline parity | Local HEAD equals `origin/main` | Both resolve to `9c55c0…` |
| Working tree | Clean before implementation | `git status --short` |
| Review branch | Created from baseline | `codex/final-portfolio-release-readiness` |
| Latest GitHub Actions CI | Passed | Run `30964892902` |
| Latest production deployment | Successful | Deployment `5753992558`, SHA `9c55c0…` |
| Dependency install | Passed | Clean `npm ci` |
| Unit tests | 29 files, 612 tests passed | Vitest baseline run |
| Dependency audit | 0 critical, 0 high, 3 moderate | npm audit/install summary |
| License file | Missing | No root `LICENSE` found |

The dependency advisories are recorded for owner visibility. This work will not apply a forced dependency upgrade without a separately justified compatibility review.

### Local browser-test caveat

The first local Playwright baseline was invalid because the existing configuration reused any process on fixed port `3000`. That port was occupied by a different workspace (`Resume Project 2/apps/web`) serving a product titled “Northstar | Corporate Credit Underwriting.” The resulting `1 passed / 18 failed / 9 skipped` output is environment contamination, not InvestIQ product evidence. GitHub CI at the baseline SHA passed. The release branch must make local E2E isolation explicit and then rerun the suite against the intended InvestIQ server.

## Verified production baseline

### Route and runtime smoke test

The following production routes returned HTTP 200 and rendered meaningful content without observed console warnings/errors at a 1440 px viewport:

- `/`
- `/about`
- `/case-study/aapl`
- `/company/AAPL`
- `/company/AAPL/financials`
- `/company/AAPL/valuation`
- `/company/AAPL/memo`
- `/company/AAPL/report`
- `/compare`
- `/portfolio`
- `/tools`
- `/tools/dca`
- `/market`
- `/methodology`

No reviewed route had horizontal overflow at the inspected desktop width. Mobile, print, blocked storage, unavailable-service states, CSV/PDF disclosure, and text-scale checks remain final-QA requirements rather than baseline claims.

### Security headers

The production homepage returned:

- Content Security Policy limiting base URI, forms, framing, and objects
- HTTP Strict Transport Security
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- a restrictive camera, microphone, geolocation, and payment permissions policy
- `Referrer-Policy: strict-origin-when-cross-origin`

### Service and SEC evidence

`GET /api/health` returned a valid unavailable-state document: market price analysis and DCA unavailable, assistant ready, and database configured. This is a legitimate fail-closed public state, not a license gate to bypass.

`GET /api/fundamentals?ticker=AAPL` returned Apple Inc. with 29 metrics. The inspected annual revenue series covered FY2021–FY2025. FY2025 revenue was `416161000000`, period end `2025-09-27`, filed `2025-10-31`, accession `0000320193-25-000079`, with an official SEC filing link.

## Confirmed strengths

- The product already has coherent Research, Compare, Portfolio, and Tools workspaces.
- SEC fundamentals remain independently available when licensed market history is unavailable.
- Public market-data access fails closed.
- The finance domain is deterministic and covered by substantial unit tests.
- English and Simplified Chinese localization infrastructure is established.
- Production routes and security headers are healthy at the baseline deployment.

## Confirmed release gaps

### P0 — truth, evidence, and featured case

1. `/case-study/aapl` is titled “AAPL research case study,” but its content is only a workflow walkthrough.
2. `docs/EQUITY_RESEARCH_SAMPLE_AAPL.md` contains an unverified `$0` net-debt placeholder.
3. The public sample includes a dated local market-price comparison that cannot be verified as licensed public data.
4. The public-demo disclosure is too technical and does not plainly state that price, comparison, portfolio, and DCA examples are synthetic—not ticker history.
5. The featured case links to “Open live AAPL research,” which blurs the stable-case and live-workspace boundary.
6. The AAPL case lacks one typed source of truth linking snapshot values, filing receipts, ownership, assumptions, scenarios, observations, risks, catalysts, invalidation, and unresolved questions.
7. English and Chinese README first screens are not aligned around the same recruiter-first story.
8. Social metadata, canonical metadata, a branded Open Graph image, release notes, limitations, and a license decision are incomplete.
9. No real participant results exist. Only an honest usability-test protocol and blank evidence templates may be published.

### P1 — product presentation and resilience

1. DCA displays “Server verified” even when service readiness is degraded.
2. The repository root and README over-emphasize implementation detail before the product proof.
3. Public LinkedIn, email, and resume URLs have not been verified and must remain null/hidden.
4. Readiness and liveness responsibilities need a documented decision; refactoring is justified only if it improves observable reliability.
5. Final accessibility, mobile, print/PDF, storage-blocked, localization, and production QA evidence is still outstanding.
6. Local Playwright execution can silently attach to an unrelated server on port `3000`.

## Files expected to change

The implementation is expected to remain concentrated in:

- a typed AAPL case-study data module plus its pure derived-observation and rendering tests
- the existing AAPL case component and route
- valuation snapshot/prefill integration only where required to align date-matched net debt
- shared data-mode/readiness copy and the affected analysis/export surfaces
- English and Simplified Chinese localization catalogs
- homepage/layout metadata and `opengraph-image.tsx`
- recruiter-first `README.md` and `README.zh-CN.md`
- `docs/assets`, `docs/usability`, `docs/audit`, and bounded release documentation
- Playwright configuration/specs and focused unit/contract tests

Finance formulas and unrelated product workspaces are not expected to change.

## Deferred owner decisions

| Decision | Baseline handling |
|---|---|
| Repository license | Do not infer or auto-license; document options and owner action |
| LinkedIn URL | Keep null and do not render until verified |
| Public email | Keep null and do not render until approved |
| Resume URL | Keep null and do not render until supplied and verified |
| Usability participants | Publish protocol/templates only; do not claim results |
| Final release/tag | Do not create in this task |
| Merge to `main` | Leave the reviewed pull request unmerged |

## Release-candidate acceptance baseline

The final branch must preserve finance and licensing contracts, remove the confirmed truth gaps, pass clean install/typecheck/lint/unit/build/E2E checks, include evidence-backed screenshots and documentation, verify a preview built from the reviewed SHA, confirm production was not modified, and conclude with a ready pull request—not a merge or release.
