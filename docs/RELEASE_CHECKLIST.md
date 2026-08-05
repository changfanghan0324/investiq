# v1.0 release-candidate checklist

This checklist prepares a release; it does not authorize merge, tag, deployment, or publication.

## Automated gates

- [ ] Clean install (`npm ci`)
- [ ] Typecheck, lint, unit/contract tests, production build
- [ ] Isolated Playwright suite and axe checks
- [ ] 320/390/768/1440 px and 100%/145% text QA
- [ ] English/Simplified Chinese, storage blocked, readiness unavailable, SEC unavailable, invalid ticker
- [ ] CSV, PDF, print, console, dead-link, forbidden-copy, audit, and secret checks
- [ ] Preview SHA equals branch SHA; production remains unchanged

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

