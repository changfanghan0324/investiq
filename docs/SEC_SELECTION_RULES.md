# SEC selection rules

Last reviewed: 2026-08-04

## Source and receipt

InvestIQ reads official SEC submissions and XBRL companyfacts on the server. Production must send a
truthful `SEC_USER_AGENT` and follow SEC fair-access guidance. A selected fact retains its concept,
unit, value, fiscal year/period, form, filing date, accession, economic start/end or balance-sheet
date, and official source URL.

## Annual duration facts

- Prefer 10-K annual facts with a duration consistent with the target fiscal year.
- Use the economic period, not merely filing date, to group a year.
- Do not sum quarterly facts into an annual fact unless a domain contract explicitly does so.
- Resolve duplicate frames and amendments deterministically; later filings do not silently replace a
  more appropriate original-period fact with a differently scoped value.
- Cross-metric constructions require matching periods.

## Instant facts

- Balance-sheet facts are selected at the target fiscal-year-end date.
- Debt and cash components must share the exact date before net debt can be constructed.
- Missing current/noncurrent debt or cash remains unavailable.
- Period-end common shares cannot substitute for diluted weighted-average shares in a DCF bridge.

## Taxonomy and fail-closed behavior

Supported concept aliases are explicit in domain selectors. Units, forms, periods, and signs are
validated. A taxonomy change, ambiguity, incomplete component set, or unsupported issuer structure
produces an unavailable state and source explanation, not a guessed number. SEC request failures are
neutral runtime errors and never trigger synthetic company financials.

## AAPL featured snapshot

The typed AAPL case snapshot and generated Markdown share the same receipts and values. Its FY2025
10-K accession, filing date, aligned net-debt components, observations, catalysts, risks, and DCF
assumption ownership are tested for completeness and drift.
