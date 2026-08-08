# FSLY fundamentals fixture contract

The executable offline fixture is `src/domain/fixtures/fundamentals-fixtures.ts`.

- This is a curated, deterministic, network-free acceptance fixture shaped from the cited SEC filing;
  it is not a live EDGAR export and should not be treated as an independent source of truth.
- FY2021–FY2025 revenue, gross profit, cost of revenue, operating income, diluted shares and diluted
  EPS are retained solely to exercise selector, reconciliation, readiness and display contracts.
- The default fixture includes the standard
  `RevenueFromContractWithCustomerIncludingAssessedTax` fact and must select one direct receipt.
- `fslyCompanyFacts(false)` removes only direct revenue and must construct the same five values from
  gross profit plus cost of revenue with two receipts per observation.
- FY2025 net debt is $181,276,000 from debt and cash; combined D&A has only one year of history.
- AAPL validates direct alias precedence. JPM identity validates the SIC financial-issuer gate.

This fixture is regression evidence, not a live data pipeline or a substitute for the official filing.
Its one-year D&A coverage is intentional: it preserves the limited-history/manual-input regression even
when the current live Company Facts payload can construct additional aligned D&A observations.
The primary evidence is Fastly's FY2025 10-K filing and filing index:

- https://www.sec.gov/Archives/edgar/data/1517413/000151741326000053/fsly-20251231.htm
- https://www.sec.gov/Archives/edgar/data/1517413/000151741326000053/0001517413-26-000053-index.htm
