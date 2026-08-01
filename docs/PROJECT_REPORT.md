# InvestIQ — Project Report

## Executive summary

InvestIQ was repositioned from a recurring-investment calculator into an evidence-first investment
research and portfolio analytics platform. The shipped workflow connects four activities that are
usually fragmented across separate tools:

1. select annual company facts from official filings;
2. convert explicit operating assumptions into valuation ranges;
3. measure how a security contributes to portfolio return and risk; and
4. preserve facts, assumptions, and interpretation in a one-page investment memo.

The primary user is an aspiring equity-research or asset-management analyst who needs a credible
portfolio demonstration without access to institutional terminals. A secondary user is a
self-directed or international investor who benefits from plain-language English or Simplified
Chinese explanations.

## Problem and objective

Young investors often collect prices, financial statements, valuation outputs, and portfolio metrics
from different websites. The resulting process is hard to audit: dates differ, return bases are
mixed, unsupported facts become zeros, and a single valuation number can hide its assumptions.

InvestIQ's objective is not to declare the best stock. It is to make the research chain inspectable:

```text
official filing facts
  → explicit calculation contract
  → scenario and sensitivity outputs
  → portfolio impact
  → evidence-linked memo
```

## Product decisions

### Progressive disclosure

The Research home asks for one ticker. Company Summary contains no more than five first-level
outputs. Detailed ratios, source receipts, forecast schedules, sensitivity matrices, and memo fields
open on their own routes. This keeps the product approachable without removing analyst detail.

### Latest-reported fundamentals are not a backtest input

SEC annual facts are selected as a current research view and can include later restatements. They
must not be inserted backward into historical price analysis. Company facts and historical market
series therefore remain separate contracts.

### Ranges before point estimates

DCF displays bear/base/bull and two sensitivity tables before a base implied share price. Current
market price is a dated, separate comparison. Comparable valuation requires user-sourced multiples;
the platform does not manufacture a peer group or an industry median.

### Withhold unsupported results

Future DCA projections are disabled. Sector exposure, forward P/E, P/B, PEG, ROIC, balance-sheet
ratios, and efficiency metrics remain unavailable where the current data contract cannot support
them. This is a deliberate data-quality feature, not an incomplete zero.

## Implemented modules

### Company Financial Analysis

- SEC ticker directory, submissions, and XBRL companyfacts adapter.
- Restatement-aware annual selection based on economic period start/end.
- Revenue, net income, operating income, diluted EPS, operating cash flow, CapEx, diluted shares,
  shares outstanding, constructed operating margin, and constructed FCF.
- Filing accession, taxonomy concept, unit, period, and source URL retained for every observation.
- Financial-industry SIC capability gate and explicit unavailable reasons.

### Valuation

- Five-year unlevered FCFF engine.
- No assumed tax benefit on operating losses when NOLs are not modeled.
- Gordon terminal value with strict `WACC > g` validation.
- EV→equity→per-share bridge and a separate dated market comparison.
- Bear/base/bull range, WACC×g sensitivity, and growth×margin sensitivity.
- P/E, EV/Revenue, and EV/EBITDA comparable ranges using user-sourced multiples.

### Portfolio Analytics

- User-defined, equal, and inverse-volatility allocation paths.
- Exact common-date alignment across one to ten holdings.
- CAGR, volatility, Sharpe, Sortino, beta, Jensen-style alpha, maximum drawdown, historical one-day
  VaR, correlation, attribution, weight drift, HHI, and effective holdings.
- Price-return/total-return basis is resolved once for the whole view and never mixed.
- CSV export retains unavailable cells as empty rather than zero.

### Investment Memo

- Company overview, financial evidence, thesis, catalysts, risks, valuation range, interpretation,
  and SEC receipt on one page.
- Notes and the last DCF snapshot persist only in browser storage.
- A dedicated bilingual A4 report route supports browser Save as PDF without sending research
  contents elsewhere, with filing receipts, DCF assumptions, limitations, and page counters.

## Important defects found through cross-review

1. **SEC fiscal-year relabeling.** Grouping comparative companyfacts by the filing's `fy` can label an
   older economic period as the newer filing year. The selector now groups by start/end period and
   derives display year from period end.
2. **DCF loss-year tax shield.** `EBIT × (1-tax)` reduced operating losses even though the model had
   no NOL/deferred-tax schedule. NOPAT now taxes positive EBIT only.
3. **Zero-enterprise-value failure.** A zero EV made terminal-value/EV undefined and originally
   rejected an otherwise finite equity bridge. The ratio is now nullable while the valuation remains
   available.
4. **Historical VaR rank precision.** `(1−0.95)×60` resolved slightly above 3 in binary floating
   point, causing `ceil` to select the fourth observation. A sample-scaled machine-precision
   tolerance restores the exact nearest-rank boundary and is regression tested.
5. **Margin CAGR misuse.** Operating-margin history was initially presented as annualized growth.
   It now reports percentage-point change.

## Evidence and methodological support

- SEC documents that `data.sec.gov` exposes submissions and XBRL companyfacts without authentication
  and notes that reporting calendars require attention: [EDGAR APIs](https://www.sec.gov/search-filings/edgar-application-programming-interfaces).
- SEC developer guidance establishes identified, fair automated access: [Developer Resources](https://www.sec.gov/about/developer-resources).
- CFA Institute describes the Sortino ratio as excess return relative to downside risk and stresses
  consistent MAR/calculation choices: [The Sortino Ratio](https://rpc.cfainstitute.org/-/media/documents/code/gips/the-sortino-ratio.pdf).
- CFA Institute explains historical-simulation VaR and warns that VaR is sensitive to choices and is
  often misunderstood as a worst-case outcome: [Measuring and Managing Market Risk](https://www.cfainstitute.org/insights/professional-learning/refresher-readings/2026/measuring-managing-market-risk).
- CFA Standard V(B) requires disclosing model inputs, risks, and limitations rather than implying a
  VaR model is definitive: [Communication with Clients](https://www.cfainstitute.org/standards/professionals/code-ethics-standards/standards-of-practice-v-b).
- Damodaran distinguishes firm cash flows discounted at cost of capital from equity cash flows and
  emphasizes matching the cash-flow and discount-rate basis: [DCF Valuation](https://pages.stern.nyu.edu/~adamodar/New_Home_Page/lectures/val.html).
- Damodaran describes stable-growth terminal value and its sensitivity to growth assumptions:
  [Estimating Terminal Value](https://pages.stern.nyu.edu/~adamodar/New_Home_Page/valquestions/termvalapproaches.htm).

## Validation strategy

- Pure domain functions are tested with hand-calculated fixtures, boundary values, insufficient
  samples, flat series, negative values, and non-finite inputs.
- TypeScript strict typecheck and ESLint run before delivery.
- Production build is required in addition to unit tests.
- Browser acceptance checks cover desktop/mobile layouts, both languages, text-scale controls,
  DCF run, memo handoff, and public error states.
- Security controls include same-origin routes, bounded bodies/responses, neutral provider errors,
  ticker/date validation, per-client rate limits, server-only keys, and prompt input/output limits.

## Known limitations and next priorities

1. A durable shared provider quota limiter and licensed production market-data agreement are still
   required for broad public scale.
2. SEC standardized facts do not provide a complete, consistent GICS sector contract, narrative
   business description, or consensus forecast set.
3. The DCF starter's net debt, cash tax, D&A, ΔNWC, WACC, and terminal growth require analyst review;
   they are not company forecasts.
4. Comparable multiples require the user to research a defensible peer set and source its range.
5. Portfolio alpha is a historical single-factor approximation; VaR is sample-dependent and not a
   loss ceiling; inverse-volatility weighting ignores correlations and expected return.
6. Browser print is intentionally used for the full report because it preserves Simplified-Chinese
   glyph coverage and line breaking without shipping a large embedded CJK font.
7. Python/FastAPI/PostgreSQL remain deferred until cross-user storage or heavier analytics justify a
   separate service.

## Outcome

The result is a coherent MSBA portfolio project: it demonstrates product judgment, primary-source
data engineering, financial modeling, risk analytics, model governance, testing, bilingual UX,
security boundaries, and deployed web engineering—without presenting educational analysis as an
institutional research service or investment advice.
