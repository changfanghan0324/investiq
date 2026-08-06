# Fundamentals coverage implementation result

Recorded: 2026-08-06

## Outcome

InvestIQ now keeps company research usable when SEC coverage is partial. FSLY FY2021–FY2025 revenue
selects the official standard `RevenueFromContractWithCustomerIncludingAssessedTax` fact as
`direct-standard`. Gross profit plus cost of revenue is a guarded fallback for missing fiscal periods
and a reconciliation diagnostic; it does not replace the filed direct fact.

FSLY's valuation workspace now exposes field-level readiness. FY2025 base revenue ($624,018,000),
diluted shares (146,902,000), constructed net debt ($181,276,000), and the -19.1% operating-margin
reference remain visible. Forecast margin and D&A stay blank and user-owned because the latest margin
is non-positive and D&A has fewer than three aligned observations. EV/Revenue is the default suitable
comparable; P/E is disabled because aligned diluted EPS is negative.

## Financial-integrity record

- Direct revenue precedence: five fiscal years, one official receipt per selected observation.
- Identity reconciliation: five aligned observations, each with zero difference.
- Revenue fallback: known non-financial SIC, direct standard legs, USD, positive finite result,
  non-negative cost, exact annual start/end and one accession.
- D&A: a combined standard fact wins; otherwise both whitelisted depreciation and amortization legs
  must align. PP&E depreciation alone is not mislabeled as combined D&A.
- Constructed duration metrics fail closed across divergent accessions.
- Forecast values remain user-owned. Generic defaults are never described as historical evidence.
- Market price remains dated provider evidence outside DCF mathematics.

## Validation

- TypeScript: passed.
- ESLint: passed with zero errors and zero warnings.
- Unit tests: 34 files / 653 tests passed.
- Playwright: 29 passed / 17 intentional cross-project or capture-only skips.
- Targeted FSLY workflow: desktop and mobile passed.
- Accessibility: Simplified Chinese, 145% text scaling, keyboard reachability and axe critical/serious
  violations passed.
- Next.js production build: passed; 17 static pages generated and all dynamic routes compiled.

## Visual audit

The `before/` and `after/` directories each contain desktop 1440×1000 and mobile 390×844 captures for:

- FSLY Summary
- FSLY Financials
- FSLY Valuation
- AAPL Valuation

The after set confirms the partial-readiness card, direct/constructed provenance labels, editable anchor
ownership, loss-making method suitability and older-evidence warning without horizontal overflow.

## Independent review

Claude CLI 2.1.223, authenticated to the owner's first-party account, ran `claude-opus-5` with high
effort in read-only session `2cab98a5-0e54-49bd-b561-4b496e5ca0fc`. The objections and their
dispositions are preserved in `FUNDAMENTALS_COVERAGE_CLAUDE_REVIEW.md`. Claude was a reviewer, never a
source of financial facts.

## Limits

- No general SEC custom-extension parser is included; unsupported extensions remain unavailable.
- FSLY combined D&A remains limited to one annual observation, so the UI asks the user for a forecast
  assumption and marks FY2021 EBITDA as older evidence.
- Reconciliation records are diagnostic metadata; a future release may surface mismatch warnings in
  the UI.
- The curated offline fixture is regression evidence, not a live EDGAR export or independent source.
