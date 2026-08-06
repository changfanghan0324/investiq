# InvestIQ methodology

Last reviewed: 2026-08-04

This document defines the analytical basis shown by InvestIQ. UI copy can summarize it but cannot
change it. Pure domain code and tests are authoritative for calculations.

## Shared analytics conventions

- Rates, returns, weights, and drawdowns are decimal fractions in domain code. Formatting and
  rounding occur only at the presentation boundary.
- A view selects one return basis. Total return uses vendor adjusted close only when every aligned
  series has complete coverage; otherwise every series uses price return. Bases are never mixed.
- Cross-security series use the intersection of trading dates. Nothing is backfilled or treated as a
  zero return. Ties resolve deterministically by date, then input order.
- Volatility, Sharpe, Sortino, beta, alpha, historical VaR, and correlation require 60 aligned daily
  returns. Fewer than 252 returns receive a limited-sample warning.
- Volatility, Sharpe, and Sortino annualize with 252 trading days. CAGR uses 365.25 calendar days.
  Square-root-of-time annualization is approximate where returns are serially correlated.
- The caller supplies the displayed risk-free rate; no hidden rate feed is used.
- Maximum drawdown is the worst close-to-close peak-to-trough decline with peak, trough, and
  recovery dates. Historical one-day VaR is an empirical nearest-rank lower-tail observation.

## Portfolio Lab

Portfolio Lab is long-only, initially weighted to exactly 100%, and buy-and-hold for its primary
result. It uses fractional shares and does not silently normalize invalid weights. Attribution,
concentration, benchmark metrics, and correlation are produced only from aligned supported inputs.
Sector exposure is unavailable without an authoritative sector source. Historical monthly,
quarterly, and annual rebalancing are scenario comparisons on the same evidence basis, not forecasts.

## Historical DCA

- Supports 1–10 unique holdings and stops at the last completed session; future periods are disabled.
- Contribution schedules execute on a completed market session. Purchases use the session's
  split-adjusted high; period-end value uses the last session's split-adjusted close.
- Cash orders, fractional-share precision, broker/platform charges, SEC/TAF/CAT components, and
  liquidation fees are calculated independently and retained in the ledger.
- Ordinary-dividend eligibility uses shares held on ex-date. Net dividends reinvest on payment date
  or the next available session. Unsupported corporate actions stop the run.
- External contributions are neutralized in unit-value TWR. MWRR/XIRR treats contributions as
  investor outflows and terminal value as an inflow. Net gain divided by contributions is labelled
  a dollar-efficiency ratio, not annualized return.
- Maximum drawdown uses cash-flow-neutral unit value. Ledger and return decompositions reconcile
  within explicit decimal tolerances.

Public DCA currently uses synthetic series. The same calculation path is exercised, but ticker labels
must not be interpreted as actual market history. See [Data Governance](DATA_GOVERNANCE.md).

## Outputs and AI

CSV and PDF exports inherit the result's data mode. Synthetic exports say `Synthetic public-demo
series` and `Not actual market history`. The AI drawer receives a compact calculated summary; it does
not receive authority to recompute, alter, recommend, or convert synthetic output into ticker history.

## Further contracts

- [Financial model contracts](FINANCIAL_MODEL_CONTRACTS.md)
- [SEC selection rules](SEC_SELECTION_RULES.md)
- [Known limitations](KNOWN_LIMITATIONS.md)

