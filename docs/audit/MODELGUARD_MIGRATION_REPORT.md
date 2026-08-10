# ModelGuard migration report

## Executive summary

InvestIQ has been pivoted in place to ModelGuard on the existing repository and Vercel project.
The active public runtime is a static, browser-local XLSX audit workflow. No market provider,
SEC API, AI assistant, database, account, upload, or analytics endpoint is connected.

## Routes

Active routes are `/`, `/workspace`, `/templates`, `/methodology`, `/privacy`, and `/about`.
Retired market/company/portfolio/DCA routes are redirect shims or Vercel redirects. The old API
routes were removed. The active navigation is Audit, Templates, Methodology, About.

## ModelGuard capabilities

- ExcelJS adapter behind a `WorkbookParser` interface, with a dedicated Web Worker.
- Central limits: 20 MB, 50 worksheets, 200,000 non-empty cells, 100,000 formulas, 5,000 named
  ranges, and a 20-second parse budget.
- SHA-256 receipt, sheet visibility, merged ranges, named ranges, formulas, cached values, and
  external-link metadata.
- Deterministic cell-specific rules for formula errors, missing sheets/cells, uncached formulas,
  hardcoded forecast cells, hidden sheets, blocked external links, and DCF terminal growth.
- Issue explorer with severity summary, observed/expected values, version compare, and local
  JSON/CSV/PDF exports.
- English and Simplified Chinese, keyboard focus, mobile layout, text scaling, and reduced-motion
  support.

## Test evidence

- TypeScript: passed.
- ESLint: passed.
- Vitest: 37 files, 665 tests passed.
- Next static build: passed; all generated application routes are static.
- Playwright ModelGuard smoke suite: 7 passed, 1 mobile accessibility duplicate skipped; no API,
  SEC, finance, or analytics requests observed during local workbook audit.

## Delivery evidence

- Migration branch: `codex/modelguard-in-place-migration`
- Pull request: [#11 — pivot public demo to local ModelGuard audit](https://github.com/changfanghan0324/investiq/pull/11) (intentionally not merged)
- Vercel preview: [investiq-git-codex-modelguard-cf8712](https://investiq-git-codex-modelguard-cf8712-cpeter0814-3476s-projects.vercel.app)
- GitHub Browser, Quality, Vercel, and Vercel Preview Comments checks: passed.
- Production alias remains on the pre-migration deployment; no production promotion was performed.

## Claude review record

No Claude CLI or callable Claude reasoning/review tool was available in this environment. No Claude
approval is claimed. Codex performed a second-pass self-review against the product, privacy,
security, accessibility, and parser contracts; the limitations are recorded in the baseline ADR.

## Remaining limitation

The parser intentionally does not execute macros, follow external links, or recalculate formulas.
Missing cached values remain unavailable. A clean report means no current rule fired; it is not a
professional accounting certification or investment recommendation.
