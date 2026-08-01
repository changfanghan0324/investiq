# InvestIQ — Investment Research & Portfolio Analytics

[![CI](https://github.com/changfanghan0324/investiq/actions/workflows/ci.yml/badge.svg)](https://github.com/changfanghan0324/investiq/actions/workflows/ci.yml)

InvestIQ is an evidence-first research platform for finance students, aspiring equity-research
analysts, asset-management interns, and self-directed investors studying US-listed companies and
ETFs. Its primary workflow is **company fundamentals → scenario valuation → portfolio risk →
investment memo**. Historical DCA and growth calculators remain supporting research tools, not the
product's main conclusion.

The interface uses progressive disclosure: the research home asks for one ticker; the company
summary limits itself to five decision-relevant outputs; financial details, DCF assumptions,
sensitivity grids, source receipts, and memo fields live on dedicated pages. A beginner can complete
the flow without knowing the formulas, while an analyst can open every assumption and filing source.

InvestIQ is research software. It does not place trades, recommend securities, provide investment or
tax advice, or call an assumption-driven value a guaranteed outcome.

Built with Next.js 16 (App Router), React 19, and strict TypeScript. Financial calculations are pure,
deterministic domain functions covered by Vitest; official annual company facts come from SEC EDGAR;
price-risk context uses end-of-day market data through server-only adapters.

- **Product specification:** [docs/INVESTIQ_PRODUCT_SPEC.md](docs/INVESTIQ_PRODUCT_SPEC.md)
- **Institutional analytics roadmap:** [docs/INSTITUTIONAL_ANALYTICS_ROADMAP.md](docs/INSTITUTIONAL_ANALYTICS_ROADMAP.md)
- **Working agreement:** [CLAUDE.md](CLAUDE.md)
- **In-app methodology:** `/methodology`

## Product flow and routes

Four primary navigation destinations keep the app understandable. Company research opens nested
detail routes only after a ticker is selected.

| Route | Workspace | What it does |
| --- | --- | --- |
| `/` | Research | Ticker-first launcher, recent local research, and entry points to company, portfolio, market, and methodology views. |
| `/company/[ticker]` | Company Summary | SEC identity plus at most five outputs: revenue, operating margin, constructed FCF, dated price-risk context, and deterministic takeaways. |
| `/company/[ticker]/financials` | Financial Analysis | Five-year growth, profitability, cash generation, coverage gates, and filing-level source receipts. |
| `/company/[ticker]/valuation` | Valuation | Five-year unlevered FCFF DCF, bear/base/bull range, two 5×5 sensitivities, EV→equity bridge, and a user-sourced comparable-multiple method. |
| `/company/[ticker]/memo` | Investment Memo | One-page evidence record separating reported facts, model assumptions, thesis, catalysts, risks, and interpretation; printable to PDF. |
| `/compare` | Stock Comparison | Two to five symbols aligned to common trading dates: cumulative return, risk table, correlation matrix, neutral narrative, and CSV. |
| `/portfolio` | Portfolio Lab | One to ten long-only holdings: return, volatility, Sharpe, Sortino, beta, alpha, historical VaR, drawdown, attribution, concentration, correlation, equal/user/inverse-volatility weights. |
| `/tools` | Research Tools | Secondary calculators and market context. |
| `/tools/dca` | Historical DCA | Completed-session recurring contributions with dividends, fees, tax scenarios, audit ledger, and multi-page PDF. Future scenarios are disabled. |
| `/market` | Market Context | ETF benchmark proxies and a browser-local watchlist. |
| `/methodology` | Methodology | Calculation rules, data contracts, limitations, and sources. |

Legacy `/stock` redirects to `/company/AAPL`; `/dca` redirects to `/tools/dca`.

Reference visual concepts for each workspace live in `design/investiq/`.

## Localization and display

- **Languages:** English (`en`) and Simplified Chinese (`zh-CN`) only.
- Every user-visible string resolves through `t()` in `src/i18n/language.tsx`. The `zh-CN` catalog is
  typed against the English catalog, so a missing key is a TypeScript error rather than a runtime
  fallback.
- **Text size:** four levels — `25`, `50`, `75`, `100` — with `25` as the default. The level is applied
  as a root multiplier (`1`, `1.15`, `1.3`, `1.45`) and every layout stays usable at `100`.
- Language and text size persist per browser in `localStorage` under the `investiq-` key namespace
  (`investiq-language`, `investiq-font-scale`, `investiq-market-watchlist`,
  `investiq-dca-portfolio-name`). No account, no server-side profile, no analytics.

## Risk Context

Risk Context is an educational panel in Portfolio Lab. The reader answers four questions —
investment horizon, the largest temporary decline they believe they could sit through, how often
they would add money, and their goal — and the panel reads the measured result of the portfolio they
already built against those answers.

Constraints enforced in `src/domain/risk-context.ts` and locked by `src/domain/risk-context.test.ts`:

- The four answers produce a descriptive **mode** (`loss-sensitive`, `balanced-context`,
  `long-horizon-variability`). A mode is a label for the answers, never a risk score, rating, or
  grade of the portfolio.
- The mode changes only which measured figures are pointed at first. No measured figure is ever
  recomputed, scaled, or softened by an answer.
- The module emits translation codes and measured numbers; the prose behind every code is held to a
  forbidden-word list by the test suite. Nothing ranks a holding, names a weight, states what to
  hold, or says what happens next.
- Contribution frequency shapes what is worth reading but never simulates contributions. Portfolio
  Lab measures one lump-sum allocation, and the reading says so.
- Deterministic and total: the same answers and the same measured figures always produce the same
  reading, in the same order. No clock, no randomness, no I/O, no storage.

## Architecture

The application remains one Next.js deployment with a server-only Neon Postgres persistence
foundation. Python/FastAPI is deferred until optimization or ETL workloads justify a second service.

```text
Browser UI (research, company, comparison, portfolio, tools)
  ├─ same-origin GET /api/fundamentals?ticker=
  │    └─ SEC EDGAR: company ticker directory, submissions, XBRL companyfacts
  ├─ same-origin POST /api/market-data  (mode: analysis | dca)
  │    ├─ Yahoo Finance: split-adjusted daily OHLC, instrument/exchange metadata, split + dividend events
  │    └─ Massive (DCA only, plus split verification): ordinary dividends and dedicated split records
  ├─ pure TypeScript fundamentals selection, DCF, comparable, portfolio, and backtest engines
  ├─ browser-local valuation/memo notes; PDF/print and CSV generation
  ├─ same-origin POST /api/assistant
  │    └─ Google Gemini: compact, report-grounded explanation
  ├─ server-only Drizzle adapter → Neon pooled PostgreSQL
  │    └─ identities, portfolios, immutable analysis/valuation receipts, peers, memos, audit log
  └─ GET /api/health → readiness only, never key values
```

- SEC companyfacts and submissions are public and require no API key. Production must set a truthful
  `SEC_USER_AGENT` contact string and respect SEC fair-access rules. Annual facts are selected by
  economic period (`start`/`end`), not the filing's `fy`, so later comparative disclosures cannot
  relabel an older fiscal year. Later-filed restatements win and every value retains an accession.
- Vendor API keys are read exclusively by modules under `src/server/`. The browser receives validated market
  data and a neutral public error message; it never receives a key.
- Public routes enforce per-client abuse rate limiting (Vercel WAF via `@vercel/firewall`; see
  [Rate limiting](#rate-limiting)) — a per-region/per-client request-rate guard, **not** a shared
  provider-call quota limiter — plus bounded JSON request sizes read incrementally, input validation,
  and request timeouts, and return neutral 5xx messages (`src/server/errors.ts`,
  `src/server/rate-limit.ts`). Provider responses and the serialized route response are also byte-bounded.
- `/api/health` reports an overall `ready`, `degraded`, or `unavailable` alongside separate
  `priceAnalysis`, `dca`, `assistant`, and `database` readiness, and nothing else. A missing Massive
  key degrades `dca` alone; price analysis stays ready, so it never forces an overall `503`.
- The database migration contract lives in `drizzle/`. Snapshot, source, and audit rows are
  append-only at the database layer; cross-owner snapshot, memo, peer, and portfolio writes are
  rejected by PostgreSQL triggers. No authenticated cloud-save UI is enabled until Auth.js has a
  real provider configuration.

### Sequential loading

Market data is loaded **strictly one request at a time, in the order shown on screen**. This is a
deliberate constraint, not an implementation detail — it bounds the burst from a single session
instead of issuing parallel calls, and it lets a portfolio hold any number of symbols. It is **not** a
deployment-wide quota control: it does nothing to bound the total provider calls made across all
concurrent users, which a licensed public live deployment must limit separately with a durable shared
provider-call limiter (see [Production licensing gate](#production-licensing-gate)).

- Stock Comparison and Portfolio Lab load the selected securities in row order, then request the
  benchmark proxy (SPY) last, because beta is the only figure that needs it.
- Stock Comparison shows a load ledger: one row per request, in issue order, with each outcome.
- A symbol that fails is reported on its own row and does not discard the symbols that already
  loaded.
- The DCA Backtest loads each holding in sequence (`src/services/create-portfolio-report.ts`).
- Vendor calls inside `src/server/market-data.ts` are likewise sequential, with a six-hour bounded
  in-memory cache for Massive responses.

## Calculation assumptions

### Shared analytics conventions

These hold across Market Context, Company price-risk context, Stock Comparison, and Portfolio Lab
(`src/domain/analytics.ts`):

- **Selected return basis — price or total, never mixed.** Price charts always show the
  split-adjusted `close`. Return, cumulative, volatility, Sharpe, Sortino, beta, alpha, historical
  VaR, correlation, CAGR, and
  drawdown are measured on one **return basis** resolved per view: **total return** (the vendor
  adjusted close, a dividend-and-split proxy) only when *every* security — and the benchmark, if
  any — has complete aligned adjusted-close coverage; otherwise **price return** for all of them, so
  a table, beta, correlation, or portfolio never mixes bases. Each view exposes Price return and
  Total return as distinct metrics when coverage exists, and labels which basis it used. The
  adjusted-close proxy is not independently audited dividend accounting; the analysis route loads no
  dividend events, so no dividend count is derived from it.
- Every rate, return, weight, and drawdown is a decimal fraction (`0.05` is +5%, `-0.2` is a 20%
  drawdown). The domain layer never converts to percent, rounds for display, or formats.
- **Sample sufficiency.** Volatility, Sharpe, Sortino, historical VaR, beta, alpha, and correlation require at least **60** aligned
  daily returns; below that they are unavailable (never `0`). The observation count is exposed, and a
  prominent **limited-sample** note appears below **252** aligned returns.
- Volatility, Sharpe, and Sortino are annualized with **252** trading days per year; CAGR uses **365.25**
  calendar days per year. The sqrt-time Sharpe annualization assumes IID returns — serial
  correlation makes it approximate (Andrew Lo, *The Statistics of Sharpe Ratios*), so it is disclosed
  as such and never treated as a definitive ranking.
- The risk-free rate used for Sharpe, Sortino, and Jensen-style alpha is always supplied by the caller, never assumed. The workspaces
  default the input to `0.00%` — an explicit user-supplied scenario assumption, **not** a current
  Treasury yield — and cap it at `25%`; it is editable and echoed in the UI, CSV, PDF, and assistant.
- Max drawdown is the worst close-to-close decline, with peak, trough, and recovery dates retained.
- Historical one-day VaR uses the nearest-rank empirical lower-tail return at an explicitly displayed
  confidence. It is a positive loss threshold, can be negative when the sampled tail remains a gain,
  and is never described as a worst-case loss or ceiling.
- Risk-adjusted portfolio weights use inverse historical annualized volatility only. The method is a
  deterministic long-only allocation rule, not an optimizer, minimum-variance portfolio, efficient
  frontier, or recommendation.
- A separate correlation-aware global minimum-variance control solves the long-only, fully invested
  historical variance objective from at least 60 aligned daily returns. The deterministic projected-
  gradient solver rejects flat, singular, and non-convergent inputs. GMV is in-sample and variance-
  only; it is not a forecast, expected-return optimizer, efficient frontier, or recommendation.
- Every function is deterministic: no clock, no randomness, no I/O.
- `undefined` means "not computable from this data", never `0`. A short history yields missing
  metrics rather than invented ones.
- Concentration flags are educational diagnostics: a single holding above **40%**, or a single sector
  above **50%**, raises a flag. Sectors are never inferred — `MarketData` carries no sector field, so
  sector concentration is reported as explicitly unavailable rather than guessed from the ticker.

### Company fundamentals contract

- Source: official SEC `submissions` and XBRL `companyfacts` APIs. No client-side SEC request and no
  API key.
- Annual eligibility: 10-K, 10-K/A, or 20-F with `fp=FY`; flow facts must span 350–380 days.
- Facts are grouped by the economic period they describe. The displayed fiscal year comes from the
  period end. The latest filed/restated observation wins; alias precedence is explicit and tested.
- Revenue, income, cash-flow, debt, assets, equity, liquidity, inventory, receivable, payable, tax,
  interest, and share-count inputs are direct standardized facts. Operating margin, FCF, EBITDA,
  total debt, net debt, and fourteen financial ratios are constructed only from components sharing
  the same annual period or balance-sheet date. Missing current or noncurrent debt makes net debt
  unavailable; an absent line is never treated as zero.
- ROE, ROA, ROIC, asset turnover, inventory turnover, receivables turnover, and cash conversion use
  consecutive year-end average balances. Gross/net margin, leverage, liquidity, interest coverage,
  and net-debt/EBITDA enforce positive-denominator and coverage gates. Quick ratio requires an
  explicit inventory fact and cash conversion requires every DIO/DSO/DPO leg. Missing inputs stay
  unavailable rather than being zero-filled.
- SEC SIC 6000–6999 activates a financial-issuer gate for revenue-margin, conventional debt,
  liquidity, interest-coverage, and manufacturing-style efficiency ratios. A missing SIC also
  withholds issuer-sensitive ratios. Every available ratio retains all component filing receipts.
- This latest-reported view is display-only and is never fed into a historical backtest.

### Valuation contract

- DCF is unlevered FCFF: revenue → EBIT → NOPAT → D&A − CapEx − ΔNWC. Operating losses receive no
  automatic tax benefit because the model does not track NOLs or deferred tax assets.
- Terminal value uses Gordon growth at the end of the final forecast year; `WACC > terminal growth`
  is a hard gate. EV bridges to equity through explicit net debt and diluted shares.
- Blank net debt is rejected rather than coerced to zero. SEC-sourced net debt is prefilled only when
  current debt, noncurrent debt, and cash align; otherwise the user must supply and own the assumption.
  Diluted weighted-average shares are required—period-end shares are not substituted.
- Historical starter values use medians only with sufficient aligned annual coverage. Comparable
  EV/EBITDA uses SEC-derived EBITDA, never a D&A forecast assumption mixed into a historical metric.
- No internal rounding. Market price never enters DCF math; the dated market comparison is separate.
- Bear/base/bull ranges and WACC×g plus growth×margin grids rerun the complete model. They are
  assumption scenarios, never called fair value, price targets, predictions, or guarantees.
- The comparable-company method applies user-sourced low/median/high P/E, EV/Revenue, or EV/EBITDA
  multiples. InvestIQ does not invent peers or industry medians. Unavailable forward P/E, P/B, and
  PEG stay unavailable with an explanation.

### Common-window alignment

Stock Comparison and Portfolio Lab measure every security over the **exact intersection** of the
holdings' trading dates. One security listing later, or missing a session, shortens the window for
all of them. Nothing is back-filled, carried forward, or read as a zero return. Ties resolve
alphabetically so the same input always compares the same way.

### Portfolio Lab: buy-and-hold only

Capital is deployed **once**, on the first trading date every holding shares. Fractional share counts
are then fixed forever: nothing is rebalanced, trimmed, topped up, or drifted back toward the target
weights. A holding that doubles simply becomes a larger fraction of the portfolio, and that drift is
reported rather than corrected. Weights must sum to 1 within `1e-6`.

### DCA Backtest calculation contract

The rules below are a product contract. Changes require accompanying regression tests and matching
updates to the in-app methodology and the PDF methodology page.

#### Supported instruments and data window

- Live mode accepts US **exchange-listed** common stocks and ETFs whose market data is USD-denominated
  and uses the `America/New_York` exchange timezone. Recognized venues include NYSE, Nasdaq, NYSE
  Arca, NYSE American, and Cboe/BATS. Over-the-counter (PNK/OTC, e.g. a foreign-settlement ADR such as
  RYCEY) and index symbols (e.g. SPX) are out of scope and receive a precise 4xx message, not a generic
  server-busy error.
- Requests carry an explicit purpose. **Analysis** workspaces (Market Overview, Stock Analysis,
  Comparison, Portfolio Lab) compute price-return analytics and do not request dividend history; they
  load Yahoo price history even without a Massive key, except when a reported split still needs
  independent verification (which fails closed). **DCA** requires Massive and strict, cross-checked
  income and corporate-action coverage. An omitted or unrecognized purpose fails safe to the strict
  DCA path.
- Historical selections start at 1990-01-01.
- Each ticker must match `A-Z`, `0-9`, `.`, or `-`, must be 1–12 characters, and may appear only once
  in a portfolio.
- Prices are Yahoo Finance **split-adjusted** daily OHLC; dividends are **not** embedded in the price
  series and are reinvested separately on their Massive pay date. Split and reverse-split events must
  reconcile exactly across Yahoo and Massive by date, ratio, and supported action type.
- For DCA, the complete ordinary-dividend multiset (ex-date + split-adjusted amount) is cross-checked
  between Yahoo and Massive across the full requested window, handling same-date duplicates within a
  small numeric tolerance. Any missing, extra, or mismatched record — including truncated provider
  history — stops the calculation rather than silently treating absent dividends as zero. A security
  with no dividends in both sources is valid.
- Only completed US core-session (9:30–16:00 ET) daily bars enter a historical result; an in-progress
  same-day bar is excluded until a conservative post-close grace has elapsed.
- A live result is identified as `yahoo` when only Yahoo was read (price-only analysis with no reported
  split) or `hybrid` when Massive was actually queried (any DCA run, or a reported split that needed
  independent verification); synthetic preview data is identified as `demo`. Every result carries a
  typed provenance object stating the price basis, last completed session, fetch time, and which
  dividend/split/reorganization checks passed. This is **not** official, real-time, guaranteed, or
  licensed institutional data, and an action absent from both providers cannot be detected. Demo
  results are never presented as coverage-checked market history.
- Calculation ends on the last available market session on or before the requested end date. If the
  requested period contains no valid session, calculation stops.

#### Recurring schedule and execution

Every schedule starts from the requested start date.

- **Day** means available trading sessions, not calendar days. Every `N` Day selects every Nth
  available session beginning with the first session on or after the start date.
- **Week:** due dates advance in seven-calendar-day increments from the original start date.
- **Month:** due dates preserve the original day where possible and clamp to the final day of shorter
  months.
- **Year:** due dates preserve the month and day where possible and clamp invalid leap-day dates.
- For Week, Month, and Year schedules, a due date that is not a market session moves forward to the
  next available session within the selected window.
- Each contribution purchase uses that execution session's split-adjusted **High**. Not the close,
  low, midpoint, or an assumed intraday timestamp.
- Period-end holdings are valued at the final session's split-adjusted **Close** unless end
  liquidation is enabled.

#### Cash orders, share orders, precision, and fees

- **USD order:** the configured cash amount is an external contribution. The engine deducts the
  calculated buy fee, buys the maximum affordable quantity, and retains any uninvested remainder as
  cash.
- **Share order:** the configured share quantity is rounded down to 0.001 share. The external
  contribution equals shares × execution price + the calculated buy fee.
- Share quantities are always **floored** — not rounded to nearest — to three decimal places.
- Share principal, residual cash, net asset value, tax basis, and tax arithmetic are carried at a
  6-decimal internal calculation precision, so a positive fractional order at a positive price can
  never round to a zero-cost purchase. Displayed currency is formatted to cents, and broker and
  regulatory fees remain rounded to cents.
- Broker fees are computed by a **versioned, broker-specific engine** that prices each order into
  auditable components — broker/platform commission, settlement, SEC Section 31, FINRA TAF, and CAT —
  each with its own rounding, floors, caps, and small-order exemptions applied **before** they are
  summed to whole cents. The order context distinguishes a cash/notional contribution buy, a
  share-quantity buy, a dividend reinvestment, and an end liquidation sell.
- Presets (Robinhood, Webull, Moomoo US and non-US, Firstrade, IBKR Lite / Pro Fixed / Pro Tiered)
  are **read-only, dated, source-backed scenarios**: because reliable historical broker schedules are
  not available for every simulated date, the selected current schedule is applied to every modeled
  order. The app never reconstructs historical broker charges, and one modeled order is treated as
  one execution — real partial fills, order minimums, symbol eligibility, routing, spread, and
  slippage are not enforced.
- Only **Other / custom** is editable. A custom rule may combine a fixed charge, a per-share charge, a
  percentage-of-value charge, a minimum, and an optional maximum, and it **never** receives hidden
  SEC, TAF, or CAT charges.
- Each preset carries official source links plus checked and effective dates, surfaced in the broker
  disclosure and the PDF report. Presets were verified on **2026-07-29**. Primary regulatory sources:
  [SEC FY2026 Section 31 advisory](https://www.sec.gov/rules-regulations/fee-rate-advisories/2026-2)
  ($20.60 per $1m, effective 2026-04-04) and the
  [FINRA 2026 TAF schedule](https://www.finra.org/rules-guidance/rule-filings/sr-finra-2024-019/fee-adjustment-schedule)
  ($0.000195/share, cap $9.79). Per-broker pages (Robinhood, Webull, Moomoo, Firstrade, IBKR) are
  linked in the app's broker disclosure.

#### Dividends and taxes

- Ordinary dividend eligibility uses shares held on the **ex-dividend date**. Entitlement is
  captured before that session's contribution buys, so shares purchased on the ex-date do not
  receive the dividend.
- If the reported ex-date is not an available session, eligibility moves to the next available
  session in the loaded history.
- A dividend whose ex-date falls **before the first available trading session** in the selected run
  is dropped: the portfolio held nothing before that session, so the ex-date is never rolled forward
  and paid to shares bought later.
- The gross dividend is eligible shares × split-adjusted cash amount per share.
- Pretax mode applies neither dividend withholding nor capital-gains tax. After-tax mode subtracts
  the user-entered dividend withholding rate and, when liquidation is enabled, the entered
  capital-gains tax rate.
- The net dividend is reinvested on the **payment date**, or the next available session, at that
  session's split-adjusted High. Any remainder that cannot buy another 0.001 share stays as cash.
- Reinvestment fees use the independent dividend-reinvestment fee rule.
- Capital-gains tax applies only in **Aftertax** mode with **Liquidate at end** enabled. Following
  IRS Publication 550, the adjusted tax basis is the purchase principal plus the acquisition fees
  paid on contribution buys and dividend reinvestments, and the amount realized is the gross market
  value minus the sell fee. The **realized gain or loss** is the amount realized minus the basis and
  may be negative.
- For a single holding the taxable gain is that figure floored at zero. **Across a Portfolio,
  holding-level tax is deferred and gains and losses net first** (IRS Topic 409 / Schedule D): the
  portfolio taxable gain is the summed amount realized minus the summed basis, floored at zero, and
  the flat rate is applied **once** to that netted gain and recorded as a single non-trade adjustment
  in the ledger — so a loss on one holding offsets a gain on another. Historical runs use the
  identical rule, and the ending balance and return decomposition reconcile within
  `1e-6`.
- This is a **simplified flat-rate estimate**, labelled as an estimate and not tax advice. It is not
  lot-level tax accounting: it does not model FIFO or specific identification, holding-period
  (short- versus long-term) rates, wash sales, lot identification, carryovers, NIIT, return of
  capital, or jurisdiction- and account-specific rules. The stock-return decomposition still uses
  purchase principal alone, so `stock price return = ending market value − purchase principal` is
  unaffected.
- End liquidation sells at the final session's Close and applies the sell fee.

#### Corporate actions and data-integrity stops

- Split-adjusted OHLC lets forward and reverse splits be represented without embedding dividend
  reinvestment in the price series. Ordinary dividends are modeled separately so they are not double
  counted.
- Special/non-recurring dividends, capital-gain distributions, returns of capital, fractional
  stock-dividend adjustments, malformed actions, and any unsupported provider-reported company event
  **stop the calculation**. A standard integer-forward split legally effected as a stock dividend is
  accepted only when Yahoo and Massive match exactly on date and ratio.
- Mergers, acquisitions, spin-offs, security exchanges, rights, and warrants are never silently
  approximated. When an event cannot be handled reliably the user receives a corporate-action safety
  error instead of a number.
- Missing or non-finite OHLC data also stops calculation.

This is a fail-closed design, but it is bounded by what upstream providers report. A missing provider
event cannot be detected locally.

#### Returns, balances, and drawdown

For each holding:

```text
stock price return       = ending market value - purchase cost
ending amount            = market value + residual cash
total profit (net gain)  = ending amount - external contributions
net gain ÷ contributions = total profit / external contributions × 100   (a dollar-efficiency
                            ratio, NOT a return and NOT annualized)
```

If end liquidation is selected, ending amount is the cash balance after sale fees and capital-gains
tax.

Performance is reported with three separate, clearly-labelled measures (`src/domain/performance.ts`):

- **Net gain ÷ contributions** — the dollar-efficiency ratio above. It ignores the timing and size of
  cash flows and is never presented as "total return".
- **Time-Weighted Return (TWR)** — cash-flow-neutral, from the flow-neutral unit-value (NAV-per-unit)
  series. External contributions issue units at the pre-flow unit value and never move it; dividends,
  dividend tax, broker fees, and reinvestment stay inside the unit value; daily sub-period returns are
  geometrically linked. Since-inception cumulative TWR is always shown; the annualized figure appears
  only after at least **365** calendar days elapse (shorter periods show the period TWR with no
  fabricated annualization).
- **Money-Weighted Return (MWRR / annualized XIRR)** — the investor experience, from daily dated
  external cash flows: contributions are negative flows on their execution dates and the
  after-fee/after-tax ending value is the terminal positive flow; reinvested dividends are internal,
  not external. Solved with a deterministic bracketed bisection under explicit iteration and
  rate-tolerance bounds. It is never `NaN`/`Infinity`: a no-root, no-flow, or ambiguous case is
  reported as unavailable with a status, never as `0`. A portfolio's MWRR uses the *combined* portfolio
  cash flows and terminal value — never an average of the per-holding IRRs.

These measures are educational estimates. They are **not** GIPS-compliant, audited, institutional
grade, investment advice, or a guarantee.

The engine independently audits every result with:

```text
stock price return
+ gross dividends
- dividend withholding tax
- capital-gains tax
- all fees
= total profit
```

Calculation stops if this cross-check differs from the ending-balance result by more than
USD 1e-6, matching the 6-decimal internal calculation precision.

Maximum drawdown uses a **cash-flow-neutral unit value**. New external contributions create units at
that session's pre-flow asset value, so a same-day market move is preserved while depositing more
money does not appear as investment performance. Portfolio metrics aggregate independently calculated
holdings; transactions are ticker-labelled and merged chronologically, and portfolio drawdown is
recalculated from the combined series. The terminal unit value is marked to the after-fee/after-tax
ending value — the same value TWR and MWRR end on — so an end sell fee or liquidation tax is internal
portfolio economics (never an external cash flow) and can create the final drawdown observation.

#### Future periods are disabled

Historical DCA results stop at the last completed real market session, and the date controls reject a
future end date. An experimental projection engine remains isolated in the repository for tests and
design research, but no current UI or report service can call it. Future sessions, dividends,
corporate actions, taxes, and execution prices cannot be represented with sufficient integrity by a
simple historical-average extrapolation, so the product withholds the number instead of presenting
false precision. If prospective scenarios return later, they must be separately labelled simulated
estimates and can never be merged with historical backtests or described as predictions.

### How DCA Backtest differs from the other four workspaces

| | Market Overview / Stock Analysis / Stock Comparison / Portfolio Lab | DCA Backtest |
| --- | --- | --- |
| Return basis | Price return, or a vendor adjusted-close **total-return proxy** when every series is covered (never mixed) | Total return from ordinary dividends modeled and reinvested from cross-checked events |
| Performance measures | CAGR, volatility, Sharpe, drawdown on the selected basis | Net gain ÷ contributions ratio, cash-flow-neutral TWR, and money-weighted MWRR/XIRR |
| Capital | Observation, or one lump-sum allocation | Recurring external contributions on a schedule |
| Execution price | Split-adjusted **close** | Split-adjusted **high** of the execution session |
| Fees | Not modeled | Versioned broker-specific fee engine with auditable components and source-backed presets |
| Taxes | Not modeled | Dividend withholding, plus capital-gains tax on optional liquidation |
| Drawdown | Close-to-close on the price or portfolio series | Cash-flow-neutral unit value, so contributions are not read as performance |
| Rebalancing | Portfolio Lab: none, weights drift and drift is reported | Not applicable; each holding runs its own schedule |
| Future periods | Not offered | Not offered; historical completed sessions only |
| Corporate actions | Split-adjusted closes | Fail-closed cross-provider verification |
| Download | Stock Comparison: CSV | Multi-page PDF report |

## Local development

### Prerequisites

- Node.js 24.x (pinned by `.nvmrc` and the `engines` field in `package.json`)
- npm
- A Massive API key for live market data
- A Google Gemini API key if the AI report explainer is required
- A Neon database only when testing persistence or migrations

### Install and configure

```bash
nvm use
npm ci
cp .env.example .env.local
```

`.env.example` contains variable names and comments only — no values. Fill in your own in
`.env.local`, which is git-ignored:

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | Persistence | Neon pooled connection used only by server-side application queries. Vercel's Neon integration supplies it. |
| `DATABASE_URL_UNPOOLED` | Migrations | Neon direct connection. `npm run db:migrate` fails closed when it is absent. |
| `MASSIVE_API_KEY` | Yes, for live data | Ordinary dividend history and corporate-action (split) verification. |
| `GEMINI_API_KEY` | Optional | The report-grounded AI explainer. Calculations, charts, CSV, and PDF export all work without it. |
| `MARKET_DATA_PUBLIC_DISPLAY_LICENSE_CONFIRMED` | Production, for live data | Server-only acknowledgement that written public-display **and** derived-analytics rights are held for **every** source. Without it, public production serves demo only. The flag grants no rights (see [Production licensing gate](#production-licensing-gate)). |

Neither variable may be prefixed with `NEXT_PUBLIC_` — both are server-only credentials, and that
prefix would publish the value in the browser bundle. Never commit `.env.local` or paste credential
values into issues, logs, screenshots, PDFs, or chat transcripts.

Start the development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Service readiness is at
`GET http://localhost:3000/api/health`, which reports only `ready`, `degraded`, or `unavailable`.

## Scripts and tests

```bash
npm run check      # typecheck + lint + test
npm run typecheck  # tsc --noEmit
npm run lint       # eslint (Next.js Core Web Vitals + TypeScript)
npm run test       # vitest run
npm run build      # production Next.js build
npm run dev        # development server
npm run start      # serve a completed production build
npm run db:generate # generate a reviewed migration from src/db/schema.ts
npm run db:check    # validate Drizzle's migration journal
npm run db:migrate # apply committed migrations; requires DATABASE_URL_UNPOOLED
```

Application queries use the pooled URL; migrations use the direct URL. Never run a raw migration
file by hand or edit Drizzle's journal. The custom governance migrations contain triggers that are
tracked by the migration journal even though Drizzle's schema diff does not introspect trigger
bodies. Apply every migration through `npm run db:migrate` exactly once per database/branch.

Test suites, all deterministic and network-free:

| Suite | Covers |
| --- | --- |
| `src/domain/analytics.test.ts` | Returns, CAGR, annualized volatility and Sharpe, drawdown peak/trough/recovery, moving averages, alignment, beta, correlation, weight validation, concentration. |
| `src/domain/backtest-engine.test.ts` | Schedules, local dates, daily-high fills, dividends, safety stops, liquidation, realized gain/loss, fee-component audit, audit cross-checks, portfolio aggregation. |
| `src/domain/fees.test.ts` | Per-broker fee schedules (Robinhood/Webull/Moomoo/Firstrade/IBKR), SEC/TAF/CAT components, exemption boundaries, custom rules, and cash-solver maximality under every discontinuous branch. |
| `src/domain/portfolio-aggregate.test.ts` | Portfolio capital-gain netting: loss offsets gain, single netted tax, deferral, decomposition reconciliation. |
| `src/domain/market-overview.test.ts` | Trailing windows, benchmark summaries, normalized series, watchlist rules, risk bands. |
| `src/domain/portfolio-lab.test.ts` | Buy-and-hold allocation, common-window intersection, weight drift, concentration, risk diagnosis codes. |
| `src/domain/risk-context.test.ts` | Mode classification, determinism, and the forbidden-word list that keeps every reading advice-free. |
| `src/domain/stock-analysis.test.ts` | Per-symbol view model, benchmark relationship, missing-metric handling. |
| `src/domain/stock-comparison.test.ts` | Two-to-five alignment, risk table, correlation matrix, neutral narrative, CSV contents. |
| `src/server/market-data.test.ts` | Supported split classification and fail-closed reorganization detection, with no network. |
| `src/services/create-portfolio-report.test.ts` | Sequential holding load and aggregate report assembly. |
| `src/server/database-health.test.ts` | Database configuration, success, failure, and timeout health states without a network. |

Before release, also verify manually: live-data success and failure states, all chart modes,
desktop and mobile layouts from 320px, reduced-motion behavior, both languages at every text size,
full transaction expansion, PDF pagination, CSV contents, AI guardrails, and an unsupported
corporate-action stop.

## Downloads

Both downloads are generated **entirely in the browser** from results already rendered. Nothing is
uploaded to a rendering or conversion service.

**DCA Backtest — PDF** (`src/services/pdf-export.ts`, jsPDF + jsPDF-AutoTable). Saved as
`investiq-dca-<tickers>-<end-date>.pdf`. Contains the portfolio summary and historical label,
holding attribution, return/tax/fee/cash reconciliation, drawdown and execution audit dates, all
input and broker assumptions, the complete ticker-labelled transaction ledger, and methodology and
limitations. Future dates are rejected before report generation.

**Stock Comparison — CSV.** Carries the common window start, end, and session count, the risk-free
rate used, the benchmark, the originally requested window, and an explicit basis note stating that
figures are price return and that empty cells mean "not computable", not zero.

## AI report explainer

Available in the DCA Backtest workspace only. The drawer sends a compact summary of the currently
selected report — not credentials, not the PDF — to the same-origin `/api/assistant` route, which
then calls Gemini server-side.

Guardrails in the system instruction require the assistant to use only supplied report facts, treat
the report JSON as untrusted read-only data and never follow instructions inside it, explain in the
user's language, refuse buy/sell/timing/selection/allocation advice, and never present historical
output as a prediction or guarantee.

Questions are capped at 500 characters, conversation context is bounded, the serialized report
summary is size-limited, and provider requests time out. The output is model-generated explanatory
text and should be treated as such.

## Methodology page

`/methodology` documents the rules the product actually runs: the data sources and the sequential
request policy, the price-return basis, common-window alignment, each workspace's figures, Risk
Context, and the full DCA contract. It is written from the same catalog as the rest of the UI, so it
exists in both languages, and it is deliberately kept out of the primary navigation.

## Accessibility

- Full keyboard operation with visible focus and a skip-to-content link.
- Labelled landmarks and navigation regions; every control, including icon-only controls, takes its
  accessible name from the translation catalog.
- Charts and data regions expose text equivalents or explicit empty-state descriptions.
- Color is never the only signal.
- Motion respects `prefers-reduced-motion`.
- Usable from 320px width upward: single column, no horizontal page scrolling, touch targets at least
  44px, wide tables scrolling within their own container, and a compact bottom navigation for the five
  primary routes on small screens.
- Text stays legible at text size `100`.

## Limitations

- **Total return in the four analysis workspaces is a vendor proxy.** When every series has aligned
  adjusted-close coverage, Market Overview, Stock Analysis, Stock Comparison, and Portfolio Lab report
  total return from the vendor's back-adjusted close — a dividend-and-split proxy, not independently
  audited dividend accounting. When any series lacks coverage they fall back to price return for all,
  which understates the total return of a dividend payer. Only DCA Backtest models dividends directly.
- **Performance labels are disciplined but not GIPS-compliant or audited.** "Net gain ÷ contributions"
  is a dollar-efficiency ratio, not a return; TWR and MWRR are the performance measures; Sharpe's
  sqrt-time annualization is approximate under serial correlation.
- **Risk metrics need a sufficient sample.** Volatility, Sharpe, beta, and correlation are unavailable
  below 60 aligned daily returns and flagged as a limited sample below 252.
- **Portfolio Lab never rebalances.** It measures a single lump-sum buy-and-hold allocation.
- **No sector data.** Sector concentration is reported as unavailable rather than inferred.
- **Past history only.** Future dates are rejected. The isolated projection engine is experimental,
  unreachable from the UI and report services, and not a product feature.
- **Corporate-action safety is bounded by the providers.** The fail-closed checks stop known
  unsupported events from being approximated, but cannot prove that an unreported event does not
  exist.
- **Vendor data may be delayed, corrected, incomplete, or rate-limited, and carries redistribution and
  public-display restrictions.** Confirm redistribution, public-display, and derived-analytics rights
  before any public or commercial use; public production is gated behind
  `MARKET_DATA_PUBLIC_DISPLAY_LICENSE_CONFIRMED` (see [Production licensing gate](#production-licensing-gate)).
- **Broker fees and tax inputs are user-configurable estimates.** Confirm current schedules,
  jurisdiction, residency, and account type independently.
- **Vercel WAF rate limiting is per-client abuse protection, not a shared provider-call quota.**
  It is a per-region/per-client request-rate guard that runs through Vercel's WAF (`@vercel/firewall`)
  and fails closed until the WAF rules are published and `RATE_LIMIT_WAF_READY=true` (see
  [Rate limiting](#rate-limiting)); the in-process limiter is a non-production fallback only. It does
  **not** bound total upstream provider calls across all users — licensed public live mode requires a
  separate durable provider-call quota limiter (see [Production licensing gate](#production-licensing-gate)).
  The 6-hour market-data cache remains per instance and is a cost/latency optimization, not a boundary.
- **AI explanations leave the deployment.** PDF and CSV generation are local, but the compact report
  summary is sent to Google Gemini. Review provider privacy, retention, and regional requirements
  before handling sensitive portfolios.
- InvestIQ is educational research software — not a broker, execution venue, investment adviser, tax
  professional, or source of guaranteed performance.

## File map

### Project root

| Path | Purpose |
| --- | --- |
| `README.md` | This document: product scope, calculation contract, architecture, setup, verification, deployment. |
| `CLAUDE.md` | Working agreement and change-control rules for contributors. |
| `docs/INVESTIQ_PRODUCT_SPEC.md` | Product specification: workspaces, localization, accessibility, ownership. |
| `package.json` / `package-lock.json` | Runtime requirements, scripts, dependencies, and the reproducible lockfile. |
| `.nvmrc` | Expected local Node.js major version (`24`). |
| `.env.example` | Environment-variable name template and comments; contains no values. |
| `.gitignore` | Excludes dependencies, builds, environment files, coverage, local QA artifacts, and generated reports. |
| `next.config.ts` | Next.js configuration and allowed local development origins. |
| `tsconfig.json` | Strict TypeScript settings and the `@/*` → `src/*` import alias. |
| `vitest.config.ts` | Vitest runtime and matching source alias. |
| `eslint.config.mjs` | Next.js Core Web Vitals and TypeScript lint configuration. |
| `vercel.json` | Pins the Vercel framework preset to Next.js. |
| `drizzle.config.ts` / `drizzle.migrate.config.ts` | Schema generation config and fail-closed direct-connection migration config. |
| `drizzle/` | Ordered SQL migrations, Drizzle snapshots, and append-only/ownership governance triggers. |
| `next-env.d.ts` | Next.js-generated type declarations; do not edit manually. |
| `design/investiq/*.png` | Current reference visual concepts, one per workspace plus mobile DCA. |
| `design/stock-lens-web-concept.png`, `design/stock-lens-web-concept-v2.png` | **Legacy design references.** Visual direction from Stock Lens, the single-workspace DCA tool InvestIQ grew out of. Retained for design history only; they do not describe the current product. |

### App entry points and API routes

| Path | Purpose |
| --- | --- |
| `src/app/layout.tsx` | Root HTML layout, fonts, metadata, language provider, and global stylesheet. |
| `src/app/globals.css` | Global reset, color foundation, font-scale variables, and reduced-motion behavior. |
| `src/app/page.tsx` | Research home route (`/`). |
| `src/app/company/[ticker]/` | Company summary plus nested financials, valuation, and memo routes. |
| `src/app/stock/page.tsx` | Legacy redirect to `/company/AAPL`. |
| `src/app/market/page.tsx` | Market Overview route (`/market`). |
| `src/app/compare/page.tsx` | Stock Comparison route (`/compare`). |
| `src/app/portfolio/page.tsx` | Portfolio Lab route (`/portfolio`). |
| `src/app/tools/page.tsx` | Secondary calculation-tools hub (`/tools`). |
| `src/app/tools/dca/page.tsx` | Historical DCA Backtest route (`/tools/dca`). |
| `src/app/dca/page.tsx` | Legacy redirect to `/tools/dca`. |
| `src/app/methodology/` | Standalone methodology page, content, and styles. |
| `src/app/icon.svg`, `src/app/favicon.ico` | Application icon and legacy favicon fallback. |
| `src/app/api/health/route.ts` | Reports market-data and assistant readiness without exposing credentials. |
| `src/app/api/market-data/route.ts` | Rate-limited, same-origin market-data POST endpoint with validation and neutral errors. |
| `src/app/api/assistant/route.ts` | Rate-limited, same-origin Gemini POST endpoint with validation and neutral errors. |

### Interface components

| Path | Purpose |
| --- | --- |
| `src/components/app-shell.tsx` | Shared shell: header, primary navigation, mobile bottom navigation, language and text-size controls, skip link. |
| `src/components/market-overview.tsx` | Market Overview workspace: benchmarks, watchlist, risk bands. |
| `src/components/stock-analysis.tsx` | Stock Analysis workspace: one symbol's price, risk, benchmark relationship, and volume. |
| `src/components/stock-comparison.tsx` | Stock Comparison workspace: alignment, risk table, correlation matrix, load ledger, CSV export. |
| `src/components/portfolio-lab.tsx` | Portfolio Lab workspace: weights, performance, drift, concentration, Risk Context panel. |
| `src/components/dca-backtest-dashboard.tsx` | DCA Backtest workspace: portfolio builder, live/demo run, result panels, attribution, transactions, PDF action, AI drawer. |
| `src/components/portfolio-performance-chart.tsx` | DCA value / return / drawdown chart with 1Y, 3Y, and full-history ranges. |
| `src/components/*.module.css` | Per-component CSS modules, all font-scale aware and mobile-first. |
| `src/config/navigation.ts` | The four primary routes and the active-route match rule. |

### Domain and calculation engines

| Path | Purpose |
| --- | --- |
| `src/domain/analytics.ts` | Shared pure analytics: returns, CAGR, volatility, Sharpe, drawdown, moving averages, beta, correlation, concentration. |
| `src/domain/market-overview.ts` | Trailing-window slicing, benchmark summaries, normalized series, watchlist rules, risk bands. |
| `src/domain/stock-analysis.ts` | One symbol's view model: price series, risk figures, benchmark relationship, volume summary. |
| `src/domain/stock-comparison.ts` | Two-to-five common-window alignment, risk table, correlation matrix, neutral narrative. |
| `src/domain/portfolio-lab.ts` | Buy-and-hold allocation, weight drift, concentration, and the educational risk diagnosis. |
| `src/domain/risk-context.ts` | Risk Context decision logic: four answers plus measured figures to an advice-free reading. |
| `src/domain/backtest-engine.ts` | Holding-level DCA accounting: orders, dividends, fees, taxes, liquidation, audit checks, drawdown. |
| `src/domain/schedule.ts` | Converts recurring Day/Week/Month/Year rules into available execution sessions. |
| `src/domain/fees.ts` | Versioned broker-specific fee engine: order-context quotes, auditable SEC/TAF/CAT/commission components with per-component rounding, the cash solver, and decimal/share helpers. |
| `src/domain/portfolio-aggregate.ts` | Merges holding results, nets capital gains and losses into one flat-rate tax, and recalculates portfolio metrics and cash-flow-neutral drawdown. |
| `src/domain/projection-engine.ts` | Isolated experimental projection code; intentionally unreachable from current UI and report services. |

### Data, server adapters, and services

| Path | Purpose |
| --- | --- |
| `src/server/market-data.ts` | Server-only Yahoo/Massive integration, validation, bounded cache, corporate-action checks, normalized responses. |
| `src/server/assistant.ts` | Server-only Gemini integration, report-bound guardrails, payload limits, provider error translation. |
| `src/server/errors.ts` | Incremental request/response byte limits, size-bounded JSON responses, and safe public/server error separation. |
| `src/server/rate-limit.ts` | Per-client/per-region abuse rate limiting via Vercel WAF (`@vercel/firewall`) with production fail-closed semantics and a non-production in-process fallback. This is not a deployment-wide provider-call quota limiter — that durable shared limiter is still absent and is required before licensed public live mode. |
| `src/server/db.ts`, `src/db/schema.ts` | Server-only Neon/Drizzle adapter and the typed 16-table persistence schema. |
| `src/server/database-health.ts` | Deduplicated, timeout-bounded Neon readiness check with no credential disclosure. |
| `src/services/market-data-api.ts` | Browser client for the same-origin market-data endpoint, with response validation and timeouts. |
| `src/services/assistant-api.ts` | Builds the compact report summary and calls the same-origin assistant endpoint. |
| `src/services/create-report.ts` | Coordinates live/demo loading, historical boundaries, and optional holding-level simulations. |
| `src/services/create-portfolio-report.ts` | Runs every holding sequentially and constructs aggregate historical and scenario reports. |
| `src/services/pdf-export.ts` | Generates and downloads the multi-page DCA PDF in the browser. |
| `src/data/demo-market-data.ts` | Deterministic, explicitly labelled synthetic series for product exploration. |
| `src/constants/broker-presets.ts` | Read-only, source-backed broker-fee scenarios with official links and checked/effective dates, plus the editable custom plan. |
| `src/i18n/language.tsx` | English and `zh-CN` catalogs, language and text-size providers, `t()`. |
| `src/i18n/risk-context-keys.ts` | Maps Risk Context translation codes to catalog keys. |
| `src/types/backtest.ts` | Shared contracts for inputs, market data, transactions, results, projections, and reports. |
| `src/utils/date.ts` | UTC-safe market-date arithmetic and local date-input round trips. |
| `src/utils/format.ts` | Central USD, percentage, share, and numeric-input formatting. |

Generated directories — `.next/`, `node_modules/`, `coverage/`, `.vercel/`, `.qa/` — are local
tooling state, not source, and are git-ignored.

## Publish to GitHub

Confirm no environment file is staged before the first push:

```bash
git status --short
git check-ignore .env.local
```

Then create the public repository with GitHub CLI:

```bash
gh repo create investiq --public --source=. --remote=origin --push
```

`.gitignore` excludes every `.env*` file except the intentionally value-free `.env.example`. Never
allow `.env.local` or any credential-bearing file into version control. If a key is ever committed,
rotate it at the provider — removing the commit is not sufficient.

## Deploy to Vercel

A standard Next.js project; no custom build command is required. Vercel uses `npm run build` and the
Node.js version declared in `package.json`.

Import the GitHub repository in Vercel, then set `MASSIVE_API_KEY` and `GEMINI_API_KEY` under
Project Settings → Environment Variables for the Production and Preview environments. Pull requests
then receive isolated preview deployments.

Or with the CLI — add credentials through the encrypted prompt so values never enter shell history:

```bash
npm install --global vercel
vercel login
vercel link
vercel env add MASSIVE_API_KEY production
vercel env add GEMINI_API_KEY production
vercel env add MASSIVE_API_KEY preview
vercel env add GEMINI_API_KEY preview
vercel deploy          # preview
vercel deploy --prod   # promote a verified build
```

After deploying, check `/api/health`, run at least one live symbol through a full workspace, export a
PDF and a CSV, and ask the assistant a report question. A successful page render alone does not
verify vendor credentials or outbound provider access.

### Rate limiting

Per-client request-rate limiting for all three provider-backed routes is enforced by Vercel's WAF through the
official [`@vercel/firewall`](https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting-sdk)
SDK. This is **abuse protection** — a per-region/per-client request-rate guard — and is **not** a
shared provider-call quota limiter: it does not bound the total upstream calls made across all users,
which licensed public live mode must limit separately (see
[Production licensing gate](#production-licensing-gate)). A per-instance in-memory counter is not a
security boundary once traffic is spread across serverless instances, so the authoritative per-client
limit lives at the edge. Until the rule is published, production **fails closed** with a neutral
`503` before any provider work runs.

Create one Firewall custom rule in the Vercel dashboard (Project → **Firewall** → **Configure** →
**+ New Rule**) using this contract:

| Setting | Value |
| --- | --- |
| Rule name | `investiq-provider-backed-api` |
| Condition | Rate Limit API ID equals `investiq-provider-backed-api` |
| Rate limit | 60 requests per 60 seconds, fixed window |
| Key | Client IP |
| Exceeded action | Rate limit (429) |

The shared stable SDK ID is defined in `src/server/rate-limit.ts` (`RATE_LIMIT_RULE_IDS`) and all
three routes call the same edge rule. This shared bucket is intentionally coarser than the route-specific
non-production fallback budgets; it fits the Vercel plan while preserving a real cross-instance
production boundary. If the rule or condition is missing, the SDK returns an error and production
**fails closed** with a neutral `503` rather than allowing unmetered traffic. The default per-IP
bucketing is correct — do not pass a constant `rateLimitKey`. **Review Changes → Publish** to apply
the rule to the production deployment.

Then confirm readiness so production stops failing closed:

```bash
vercel env add RATE_LIMIT_WAF_READY production   # value: true
```

Fail-closed semantics (`src/server/rate-limit.ts`):

- **Production** (`VERCEL_ENV=production`): if `RATE_LIMIT_WAF_READY` is not exactly `true`, every
  request to all three routes returns a neutral `503` before provider work — the deployment refuses to run
  behind an unproven limiter. When the flag is set, the WAF's per-client rate-limit decision is
  authoritative (it does not bound total provider quota across users); a WAF error also fails closed
  with a neutral `503`, and an exceeded limit returns a neutral `429`.
- **Preview / development**: a deterministic in-process fallback limiter is used so a missing WAF rule
  does not block iteration. It is per-instance and **must never** be treated as a production boundary.
- `x-forwarded-for` is never trusted as an application security identity; the trusted client is
  derived by the Vercel edge inside `checkRateLimit`.
- A `not-found` (renamed/unpublished rule) or `blocked` result from the SDK is treated as a limiter
  failure and fails closed with a neutral `503`; a missing rule never silently allows traffic.

> The `@vercel/firewall` package is a regular production dependency imported statically, so Vercel's
> output file tracing reliably includes it. Run `npm install` after pulling these changes so it is
> fetched and `package-lock.json` is updated; it must be installed for local development, tests, and
> `npm run build` to resolve the import.

### Production licensing gate

Yahoo Finance and Massive impose redistribution and public-display restrictions on their data. A
public production deployment therefore **fails closed**: unless the operator sets the server-only
`MARKET_DATA_PUBLIC_DISPLAY_LICENSE_CONFIRMED=true`, every live market-data route returns a neutral
service-unavailable response before any provider work, and the browser keeps its clearly-labelled demo
mode. Local and preview deployments are ungated, so personal credentials can be used for private
testing.

The flag confers **no rights of any kind** — setting it only records that the operator has confirmed
they already hold them. Enable it only after securing written rights that cover public end-user display
*and* derived analytics for **every** source in use, and treat it as server-only: never prefix it with
`NEXT_PUBLIC_`, and never log or surface its value. `/api/health` reflects the gate — when it blocks
live data, both `priceAnalysis` and `dca` report `unavailable`.

Licensed public live mode additionally requires a durable, deployment-wide **provider-call quota
limiter**: a shared counter or queue that bounds the total upstream calls made across all users and
serverless instances. The per-client WAF rate limit above is abuse protection, not that quota control,
and this round intentionally does not add one (no Redis or other shared-store dependency is introduced).
Until such a limiter exists, do not treat this deployment as safe for licensed public live traffic.

## Security notes

- API keys are read only in server modules and are never intentionally serialized to the browser.
- Same-origin routes are per-client rate limited at the Vercel edge (abuse protection, not a
  provider-call quota; fail-closed in production; see [Rate limiting](#rate-limiting)), validate ticker
  and date inputs, bound request and provider response sizes by bytes, cap AI report size and history,
  enforce timeouts, and return neutral 5xx messages.
- Upstream requests include the Massive key as that provider requires. Server logs and observability
  exports must redact request URLs and authorization material.
- Do not place secrets in `NEXT_PUBLIC_*`, source code, Git history, client error messages,
  screenshots, or analytics events.

## Project history

InvestIQ began as **Stock Lens**, a single-workspace DCA backtesting tool. The recurring-investment
engine, the fail-closed corporate-action checks, and the PDF report carried over; the five-workspace
analytics platform, the shared price-return analytics layer, Risk Context, and the bilingual
interface are new. The only remaining Stock Lens artifacts are the two legacy design images noted in
the file map.

## License and disclaimer

This project is a personal portfolio project provided for educational purposes. It is not financial,
investment, or tax advice. Nothing in this repository or its output is a recommendation to buy or
sell any security. Market data belongs to its respective providers and is subject to their terms.
