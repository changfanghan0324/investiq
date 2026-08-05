# v1.0 release-candidate checklist

This checklist prepares a release; it does not authorize merge, tag, deployment, or publication.

## Automated gates

- [x] Clean install (`npm ci`)
- [x] Typecheck, lint, 33 files / 643 unit-contract tests, production build
- [x] Isolated Playwright: 21 passed / 11 project-specific skipped / 0 failed; axe checks pass
- [x] 320/390/768/1440 px screenshot/browser coverage and 100%/145% text QA
- [x] English/Simplified Chinese, readiness unavailable, SEC unavailable, invalid ticker
- [x] CSV/PDF contracts, print, console, local links, forbidden copy, audit (0 vulnerabilities), and secret checks
- [ ] Preview SHA equals branch SHA; production remains unchanged
- [ ] After merge, verify the case CTA's generated written sample now resolves to updated `main`

## Product/data gates

- [x] AAPL case uses aligned SEC receipts, verified net debt, owned assumptions, and no market price
- [x] Public synthetic disclosure is visible across UI and exports
- [x] Multi-security evidence mode is pinned per run
- [x] README scope and metadata match the product
- [ ] If public live-data rights are enabled, replace deployment-level synthetic homepage copy and
  verify provider attribution, snapshot/staleness policy, and durable quota controls

## Owner-only gates

- [ ] Select license and add LICENSE
- [ ] Verify/approve LinkedIn, public email, and résumé URL
- [ ] Conduct and synthesize real participant testing (no results are currently claimed)
- [ ] Approve demo video, if created
- [ ] Review preview and approve merge
- [ ] Approve tag and GitHub Release
