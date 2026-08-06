# Fundamentals coverage baseline

Recorded: 2026-08-06

## Revisions

- Main and production revision: `249a291349b1a4a4932b84cf1fd260eee9fc4c93`
- Working branch: `codex/partial-fundamentals-coverage`
- Production URL: `https://investiq-eight-xi.vercel.app`

## FSLY production state before the change

The settled `/api/fundamentals?ticker=FSLY` payload covered FY2021–FY2025 but marked revenue and
operating margin unavailable. Gross profit, cost of revenue, operating income, diluted shares,
negative diluted EPS, net debt and free cash flow were available. Combined D&A covered FY2021 only.

The settled valuation route replaced the complete page with: “Revenue, operating margin, and
diluted-share anchors are required before this DCF can run.” The hidden form defaults were growth 5%,
margin 15%, tax 21%, D&A/revenue 3%, CapEx/revenue 4%, ΔNWC 0%, WACC 9% and terminal growth 2.5%.
Margin, D&A and CapEx used static “historical starter” labels even when their defaults were generic.
The comparable-method state always initialized to P/E.

The production AAPL valuation rendered normally with FY2025 revenue of $416.2B and approximately
15B diluted shares. Financial issuers retained the existing SIC 6000–6999 analysis gates.

## Root-cause evidence correction

The initial request attributed FSLY revenue to a custom extension. Direct inspection of the official
FY2025 iXBRL showed the whole-entity revenue fact uses the standard concept
`us-gaap:RevenueFromContractWithCustomerIncludingAssessedTax`. InvestIQ omitted that concept from its
ordered aliases. Financial integrity therefore requires actual FSLY revenue to be classified as a
direct standard fact. The gross-profit-plus-cost identity remains a separately tested fallback and
reconciliation, not a reason to downgrade FSLY to “constructed.”

## Baseline validation record

- Unit tests: 33 files / 643 tests passed before this branch.
- Playwright: 26 passed / 14 intentional project skips before this branch.
- No console errors appeared on the settled production FSLY valuation failure state.

## Before screenshots

- `fundamentals-coverage/before/fsly-summary-desktop.png`
- `fundamentals-coverage/before/fsly-summary-mobile.png`
- `fundamentals-coverage/before/fsly-financials-desktop.png`
- `fundamentals-coverage/before/fsly-financials-mobile.png`
- `fundamentals-coverage/before/fsly-valuation-desktop.png`
- `fundamentals-coverage/before/fsly-valuation-mobile.png`
- `fundamentals-coverage/before/aapl-valuation-desktop.png`
- `fundamentals-coverage/before/aapl-valuation-mobile.png`

Screenshots were captured after client loading settled, not from the initial server-rendered loading state.
