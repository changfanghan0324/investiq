# ModelGuard professional-review update

This update keeps workbook processing browser-local. It adds deterministic sample workbooks,
expected-finding receipts, a rule catalogue, evidence-oriented filters, version-change types,
and local JSON/CSV/PDF exports. No workbook bytes are uploaded and no AI, market-data provider,
SEC API, database, or analytics endpoint is used.

## Published sample outcomes

| Sample | Expected deterministic findings | Observed result |
| --- | --- | --- |
| Clean Model | None | No issues; `Ready for review` with the clean-result disclaimer |
| Balance Sheet Error | `MG-ACC-001` | Found |
| DCF Error | `MG-DCF-001` | Found |
| Hardcode Error | `MG-ASM-004`, `MG-ASM-006` | Found |
| Scenario Error | `MG-SCN-004` | Found |
| Error Sample Model | Published rule-ID list in the Templates and Audit surfaces | Found; `Needs review` |
| Version Before → After | Resolved 3, Persisting 0, New 1 | Resolved 3, Persisting 0, New 1 |

The sample test compares the actual rule-ID set with the published expected set. A clean result
means no configured deterministic issue fired; it is not professional accounting certification,
investment advice, or proof that a workbook is error-free.

## Verification evidence

- Vitest: 40 files, 677 tests passed.
- TypeScript typecheck: passed.
- ESLint: passed.
- Next static production build: passed; 20 static routes generated.
- Playwright: 23 passed, 1 accessibility duplicate skipped. The suite covers clean/error samples,
  expected findings, filters, local downloads, version comparison, redirects, bilingual UI,
  145% text size, mobile layout, wrong format, unreadable workbook, oversized workbook, and blank
  workbook handling. Requests to API/SEC/finance/analytics paths are asserted absent.

## Export examples

Templates exposes local downloads for the generated `.xlsx` fixtures and a JSON audit receipt:

- `public/samples/modelguard-clean-model.xlsx`
- `public/samples/modelguard-balance-sheet-error.xlsx`
- `public/samples/modelguard-dcf-error.xlsx`
- `public/samples/modelguard-hardcode-error.xlsx`
- `public/samples/modelguard-scenario-error.xlsx`
- `public/samples/modelguard-version-1.xlsx`
- `public/samples/modelguard-version-2.xlsx`
- `public/samples/modelguard-sample-audit-report.json`

Audit exports contain the model filename, SHA-256, provenance, generation time, ModelGuard and
rule versions, worksheet/formula counts, issue counts, limitations, and cell-level evidence.
The PDF is paginated locally and includes the audit summary, critical/high findings, all finding
IDs, version summary when available, cache/recalculation limitations, and the non-certification
statement.

## Known limits and review risks

- Excel formulas are read from formula text and stored cached values; ModelGuard does not
  recalculate Excel. Users should recalculate and save in Excel before upload.
- Macros, external links, unsupported workbook features, and complex circular references are not
  executed. Direct circular-reference signals are only a risk heuristic.
- Mapping-based accounting, DCF, assumption, and scenario rules can be not-applicable or
  cannot-verify when labels, periods, units, or cached values are missing or non-standard.
- A documented exception can look like a hardcode, scenario ordering issue, or concentration
  risk. Conversely, an undocumented convention can evade a deterministic mapping. The rule
  catalogue records the expected false-positive and false-negative risks for each rule.
- Named ranges are preserved and included in version receipts; their mere presence is not treated
  as an error. Full semantic evaluation of names remains outside the local parser scope.

## Modified surfaces

Home, Audit workspace, Templates, Methodology, Privacy/About copy, sample generator, parser/schema,
audit engine, rule catalogue, export service, English/Simplified Chinese translations, and
Playwright/Vitest coverage were updated. Retired InvestIQ routes still redirect to the local
ModelGuard workflow.
