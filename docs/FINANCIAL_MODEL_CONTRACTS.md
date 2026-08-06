# Financial model contracts

Last reviewed: 2026-08-06

## Fundamentals

Annual company evidence comes from SEC submissions and XBRL companyfacts. Selected facts preserve
their economic period and filing receipt. Revenue, operating income, net income, diluted EPS,
operating cash flow, CapEx, cash, debt, and share inputs are unavailable when the required taxonomy
or aligned period is unavailable. Financial issuers (SEC SIC 6000–6999) are gated from conventional
industrial-company margin/debt/FCF interpretations where those definitions are not comparable.

Direct standard facts have precedence. When direct revenue is absent for a period, a known
non-financial issuer may use `revenue = gross profit + cost of revenue` only from direct, whole-entity,
USD components with identical annual start/end dates and accession. Direct revenue is never replaced;
the same identity is used only to emit an aligned/mismatch diagnostic. Combined D&A also has
precedence over the whitelisted `depreciation + amortization` fallback. Every construction retains all
component receipts.

Constructed free cash flow is operating cash flow minus CapEx using aligned annual facts. Net debt is:

```text
current interest-bearing debt
+ noncurrent interest-bearing debt
- cash and cash equivalents
```

Every component must share one balance-sheet date. Missing current debt, noncurrent debt, or cash
blocks the bridge; no component is coerced to zero. Marketable securities are excluded from this
defined bridge and disclosed separately where useful. Diluted weighted-average shares are not
replaced by period-end shares.

## DCF

The existing deterministic domain implements five-year unlevered FCFF:

```text
Revenue
× operating margin = EBIT
- cash taxes = NOPAT
+ D&A
- CapEx
- change in NWC
= FCFF
```

Operating losses receive no artificial tax benefit. Forecast revenue growth, margins, tax rate,
D&A/revenue, CapEx/revenue, change-in-NWC/revenue, WACC, and terminal growth are explicit inputs.
Terminal growth must remain below WACC. Discounted forecast FCFF plus discounted terminal value
produces enterprise value; explicit net debt and diluted weighted-average shares bridge to per-share
output. Blank or incomplete bridge inputs are rejected.

The page itself is not rejected when one field is missing. Readiness is evaluated per anchor. Trusted
SEC values remain editable, manual overrides remain user-owned, and Run is disabled only while a
required input is blank or invalid. Historical starters require at least three aligned observations.
For a loss-making issuer, the latest operating margin is displayed as a reference but a positive
forecast margin is never invented; the forecast margin remains an explicit user assumption.

No internal rounding occurs. Rounding is display-only. Market price never enters DCF math. The
featured AAPL case omits public market-price comparison entirely.

## Scenario and sensitivity contract

Bear, base, and bull scenarios rerun the same DCF domain function; the component does not calculate a
second valuation. Sensitivity cells also rerun the domain across stated WACC/growth or growth/margin
grids. Terminal-value share is reported as model concentration, not confidence. Outputs are values
under stated assumptions, not forecasts, price targets, fair values, or recommendations.

## Comparable method

Comparable EV/EBITDA is a user-sourced method separate from DCF. Historical EBITDA uses SEC-derived
operating income plus aligned D&A and does not borrow the DCF forecast D&A assumption. Comparable
inputs and sources must remain explicit. P/E is meaningful only for positive aligned diluted EPS;
EV/Revenue requires positive revenue plus shares and net debt; EV/EBITDA requires positive aligned
EBITDA. The UI selects the first suitable method rather than defaulting every issuer to P/E.

## Change policy

Financial formulas are frozen for release hardening unless a reproducible bug exists. A change
requires a failing test, documented current behavior, independent finance review, a pure-domain fix,
a regression test, and methodology updates. Outputs must never be tuned toward a market price.
