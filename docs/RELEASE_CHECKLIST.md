# v1.0.0 release checklist

This checklist records release preparation; merge and production promotion still require the
reviewed SHA to be verified after deployment.

## Automated gates

- [x] Clean install (`npm ci`)
- [x] Typecheck, lint, 34 files / 654 unit-contract tests, production build
- [x] Isolated Playwright: 29 passed / 17 project-specific skipped / 0 failed; axe checks pass
- [x] 320/390/768/1440 px screenshot/browser coverage and 100%/145% text QA
- [x] English/Simplified Chinese, blocked browser storage, readiness unavailable, SEC unavailable, invalid ticker
- [x] CSV/PDF contracts, print, console, local links, forbidden copy, audit (0 vulnerabilities), and secret checks
- [ ] Preview SHA equals branch SHA; production remains unchanged
- [ ] After merge, verify the case CTA's generated written sample now resolves to updated `main`

## Product/data gates

- [x] AAPL case uses aligned SEC receipts, verified net debt, owned assumptions, and no market price
- [x] Public synthetic disclosure is visible across UI and exports
- [x] Multi-security evidence mode is pinned per run
- [x] Vercel production and preview deployments both enforce the public-display licensing gate
- [x] README scope and metadata match the product
- [ ] If public live-data rights are enabled, replace deployment-level synthetic homepage copy and
  verify provider attribution, snapshot/staleness policy, and durable quota controls

## Owner-only gates

- [x] Select MIT for repository code/documentation and add LICENSE
- [ ] Verify/approve LinkedIn, public email, and résumé URL
- [x] Publish a five-person structured proxy evaluation without claiming human participant results
- [ ] Conduct and synthesize the specified real participant testing before claiming human metrics
- [ ] Approve demo video, if created
- [ ] Review preview and approve merge
- [ ] Approve tag and GitHub Release after the reviewed SHA is deployed
