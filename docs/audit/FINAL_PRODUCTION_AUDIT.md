# Final production audit

**Review date:** 2026-08-08
**Scope:** InvestIQ public portfolio/recruiter release (`v1.0.0` preparation)
**Review owner:** Lead Product Engineer / Investment Research Reviewer

## Executive result

InvestIQ is suitable for a public, read-only portfolio demonstration when it remains in the
documented synthetic-market mode. Company fundamentals are sourced from SEC EDGAR and keep source
receipts; market examples fail closed when display rights or service prerequisites are absent. No
calculation contract was changed in this release-readiness pass.

The release is **ready for a reviewed pull request and a draft v1.0.0 release**. Production
promotion is intentionally still a separate gate: the production alias must be built from the
reviewed SHA and the owner must verify the deployed metadata, health response, and public-demo
disclosure after merge.

## Audit evidence

| Area | Evidence | Result |
| --- | --- | --- |
| Build and type safety | `npm run typecheck`, `npm run lint`, `npm run test`, `npm run build` | Required gates; final CI run is the release source of truth |
| Browser and a11y | Isolated Playwright config, axe checks, 320 px and desktop project coverage | Browser job is separate from quality job; failures upload diagnostics |
| SEC boundary | `src/server/sec.ts`, `src/domain/fundamentals.ts`, SEC/domain regression suites | Fail-closed validation, economic-period selection, receipts, no invented values |
| API boundaries | `/api/health`, `/api/fundamentals`, `/api/market-data`, `/api/assistant` | Neutral public errors, bounded bodies, cache/rate-limit controls |
| Security headers | `next.config.ts` | CSP, HSTS at the platform, frame/object/form restrictions, referrer and permissions policy |
| Search discoverability | `src/app/robots.ts`, `src/app/sitemap.ts`, shared metadata helper | Editorial pages indexable; operational and ticker pages noindex |
| Documentation | README, methodology, governance, SEC audit, CI audit, usability audit | Recruiter-facing scope and limitations are explicit |

## Runtime and reliability review

### Healthy paths

- The health route reports capability, not a misleading provider round trip. Missing live-market
  licensing degrades price analysis/DCA without hiding SEC research.
- Fundamentals responses are limited to a bounded JSON payload and use `s-maxage` with stale-while-
  revalidate because filings are not tick-by-tick data.
- Market and assistant routes use the shared bounded response/request helpers and neutral public
  errors; upstream bodies and credentials are not returned to the browser.
- Production rate limiting fails closed until the shared WAF rule and the explicit readiness flag are
  present. Preview/development uses only the documented non-security local fallback.
- User inputs and report state are preserved when the live service is unavailable, so the public
  demo can still demonstrate deterministic calculations without pretending to have live history.

### Release risks and mitigations

| Severity | Risk | Mitigation / owner action |
| --- | --- | --- |
| P1 | Public live-market display rights and durable provider quota are not granted by code alone | Keep production licensing flag and WAF readiness unset until written rights and shared quota controls are verified |
| P1 | A deployment can be healthy while a provider later changes taxonomy or coverage | Preserve unavailable states, receipt-level provenance, and run the SEC regression suite on every change |
| P1 | Production promotion could drift from the reviewed pull-request SHA | After merge, compare the Vercel production SHA to the release tag before announcing the release |
| P2 | No authenticated profile or cloud-save layer exists | Documented limitation; browser-local preferences are optional and contain no research profile data |
| P2 | No external error-monitoring connector is committed | Use Vercel runtime logs and the neutral error boundaries for v1.0.0; add monitoring before enabling public live mode |
| P2 | Human participant testing cannot be completed inside this repository-only workflow | Publish the structured proxy evaluation separately and do not label it as human research |

## Product truth checks

- The home page and all analytical workspaces state that public market examples are synthetic and
  not the named securities' historical performance.
- DCF mathematics remains based on user-owned assumptions and SEC-derived anchors; market price is
  not silently inserted into the model.
- Missing SEC fields stay unavailable. Financial issuers receive model-specific applicability
  treatment rather than manufacturing-style metrics being fabricated.
- AI explanations are optional, report-grounded, and cannot change any calculation.
- No user-visible page tells a reader that a ticker-labeled synthetic path is real history.

## Accessibility and interaction checks

- Semantic landmarks, skip link, labelled inputs, keyboard-reachable buttons, visible focus, and
  reduced-motion behavior are part of the existing shell and E2E contract.
- The release checks include the compact 320 px viewport and desktop coverage; the final browser
  job is the acceptance record for 390/768/1440 manual or CI captures.
- The unused DCA overflow/ellipsis control was removed. DCA result copy now uses singular/plural
  translation keys, and component copy no longer branches on `locale.startsWith("zh")`.
- No redesign was introduced; changes are limited to wording, controls, metadata, and release
  packaging.

## Final disposition

**Disposition: release candidate ready for PR review; production promotion pending reviewed merge
and post-deploy smoke verification.** The remaining risks are documented product boundaries, not
silent data or calculation failures.
