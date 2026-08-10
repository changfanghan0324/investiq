# ModelGuard product specification

## Product promise

“Check a financial model before someone else does.” ModelGuard is an educational, evidence-first
workbook audit tool. It reports what a deterministic rule observed; it does not certify a model,
recommend an investment, or predict a result.

## Public route contract

| Route | Purpose |
| --- | --- |
| `/` | Product launcher and privacy promise |
| `/workspace` | Local XLSX upload, audit, issue explorer, version compare, and exports |
| `/templates` | Workbook structures and sample downloads |
| `/methodology` | Rule and evidence boundaries |
| `/privacy` | Local-only processing and security contract |
| `/about` | Product context and audience |

Old InvestIQ routes redirect to the nearest ModelGuard page through the same Vercel project.

## Non-goals

- No market prices, market history, SEC retrieval, portfolio return/risk analytics, DCA backtests,
  valuation opinions, trade execution, advice, AI assistant, account, or cloud save.
- No silent formula repair, inferred missing values, or opaque model score.
- No upload, external relationship fetching, macros, external calculation engine, or browser
  persistence for workbook content.

## Information architecture

The primary shell is `Audit`, `Templates`, `Methodology`, and `About`. The workspace uses
progressive disclosure: file acceptance and privacy first, then parser receipt, then summary,
cell-specific issues, version changes, and exports.
