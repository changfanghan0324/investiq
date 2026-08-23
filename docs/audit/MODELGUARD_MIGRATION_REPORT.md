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
- Home `Try the sample model` lazily loads a build-time bundled clean workbook, sends it through
  the same Web Worker parser and deterministic audit engine as a user file, and labels the result
  `Sample model · Synthetic fictional company`. Unknown sample IDs fail closed without arbitrary
  asset paths; `Upload your own model` exits sample mode.
- Deterministic cell-specific rules with stable IDs, severity, status, period, observed/expected
  values, difference/tolerance, why-it-matters, and how-to-verify guidance.
- 38-rule catalogue: 11 spreadsheet/structure/linkage, 5 accounting, 11 DCF, 5 scenario, and 6
  assumption governance rules. Accounting controls cover statement tie-outs, debt-to-balance-sheet mapping,
  diluted shares, FCFF identity, DCF bridges, scenario connectivity, and assumption ownership.
- Issue explorer with critical/high/medium/passed/cannot-verify summary, All/Critical/DCF filters,
  version findings classified as new/resolved/persisting, and local JSON/CSV/PDF exports.
- English and Simplified Chinese, keyboard focus, mobile layout, text scaling, and reduced-motion
  support.

## Test evidence

- TypeScript: passed (`tsc --noEmit --incremental false`).
- ESLint: passed with no warnings.
- Vitest: 40 files, 677 tests passed, including published sample expectations, finance-rule
  pass/fail/unavailable, version-finding, tolerance-boundary, and real-workbook-shaped smoke coverage.
- Next static build: passed; all generated application routes are static.
- Playwright ModelGuard suite: 23 passed, 1 mobile accessibility duplicate skipped; the suite
  covers the bundled sample CTA and reload/exit flow, unknown sample IDs, clean/error golden
  workbooks, rule IDs, filters, local exports, clear-session behavior, version comparison,
  redirects, bilingual scaling, axe, and zero API/SEC/finance/analytics requests.

## Golden workbook evidence

- `modelguard-clean-model.xlsx`: 0 critical, 0 high, 0 medium, 51 period/check passes, 0
  cannot-verify; model status `Ready for review`.
- `modelguard-error-model.xlsx`: 8 critical, 21 high, 11 medium, 1 info, 18 passes, 8
  cannot-verify; model status `Needs review`. Seeded Rule IDs are recorded in
  [the error manifest](../samples/ERROR_MODEL_MANIFEST.md). The terminal-value formula is
  explicitly `cannot-verify` when WACC is not above terminal growth; ModelGuard does not force a
  calculation through an invalid denominator.
- Version 1 → Version 2 resolves 3 findings (`MG-DCF-001`, `MG-ASM-001`, `MG-ASM-006`),
  persists 0, and introduces 1 new scenario finding (`MG-SCN-004`). The pair also reports
  cell-level changes across the WACC/growth, assumption-source, forecast-hardcode, and scenario
  cells so the comparison is meaningful in a recruiter demo.
- Three self-authored Excel-shaped smoke fixtures are checked into `public/samples`: a
  three-statement + DCF model, a DCF-only model, and an FP&A forecast. Each parses, audits, and
  exports locally; intentionally incomplete shapes retain `cannot-verify` outcomes rather than
  inferred values.

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
The upload surface now states that ModelGuard reads formula text plus workbook-cached values and
asks users to open, recalculate, and save in Excel before upload for the most complete review.
Missing cached values remain unavailable. A clean report means no current rule fired; it is not a
professional accounting certification or investment recommendation.
