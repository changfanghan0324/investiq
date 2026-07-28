# InvestIQ

InvestIQ is an educational investment analytics platform for US-listed common stocks and ETFs. It
reads end-of-day market data and explains risk and return — performance, volatility, drawdown,
correlation, concentration, and recurring-investment backtests — across five workspaces, and states
every calculation rule in plain language on a standalone methodology page.

It is research software. It does not place trades, does not provide investment or tax advice, and
does not guarantee that market data or broker fee schedules are complete, current, or unrevised.

Built with Next.js 16 (App Router), React 19, and TypeScript in strict mode. The calculation layer
is pure TypeScript with no runtime dependencies and is covered by deterministic Vitest suites.

- **Product specification:** [docs/INVESTIQ_PRODUCT_SPEC.md](docs/INVESTIQ_PRODUCT_SPEC.md)
- **Working agreement:** [CLAUDE.md](CLAUDE.md)
- **In-app methodology:** `/methodology`

## Workspaces

Five primary routes, declared in `src/config/navigation.ts`, plus standalone documentation.

| Route | Workspace | What it does |
| --- | --- | --- |
| `/` | Market Overview | ETF benchmark proxies (SPY, QQQ, DIA) and a browser-local watchlist: trailing return, annualized volatility, max drawdown, and educational risk bands. |
| `/stock` | Stock Analysis | One symbol: price history, moving averages, CAGR, volatility, Sharpe, max drawdown, benchmark beta and correlation, volume summary, and a historical drawdown illustration. |
| `/compare` | Stock Comparison | Two to five symbols aligned onto the trading dates they all share: cumulative price return, risk table, correlation matrix, neutral narrative, and a locally generated CSV. |
| `/portfolio` | Portfolio Lab | Long-only buy-and-hold weights summing to 100%: performance, drawdown, weight drift, concentration diagnostics, correlation, and the Risk Context panel. |
| `/dca` | DCA Backtest | Recurring contributions with dividend reinvestment, broker fees, taxes, liquidation, cash-flow-neutral drawdown, simulated future scenarios, a multi-page PDF report, and a report-grounded AI explainer. |
| `/methodology` | How it works | Documentation of every calculation rule. Deliberately outside `primaryRoutes`. |

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

A single Next.js App Router deployment. Vendor credentials never leave the server.

```text
Browser UI (five workspaces)
  ├─ same-origin POST /api/market-data
  │    ├─ Yahoo Finance: daily OHLC, instrument metadata, split events
  │    └─ Massive: ordinary dividends and dedicated split verification
  ├─ pure TypeScript analytics + backtest engines, executed in the browser
  ├─ browser-local PDF (DCA Backtest) and CSV (Stock Comparison) generation
  ├─ same-origin POST /api/assistant
  │    └─ Google Gemini: compact, report-grounded explanation
  └─ GET /api/health → readiness only, never key values
```

- API keys are read exclusively by modules under `src/server/`. The browser receives validated market
  data and a neutral public error message; it never receives a key.
- Both POST routes enforce per-instance rate limiting, bounded JSON request sizes, input validation,
  and request timeouts, and return neutral 5xx messages (`src/server/errors.ts`).
- `/api/health` reports `ready`, `degraded`, or `unavailable` per service and nothing else.

### Sequential loading

Market data is loaded **strictly one request at a time, in the order shown on screen**. This is a
deliberate constraint, not an implementation detail — it keeps the product inside a limited
market-data quota instead of issuing a burst of parallel calls, and it lets a portfolio hold any
number of symbols.

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

These hold across Market Overview, Stock Analysis, Stock Comparison, and Portfolio Lab
(`src/domain/analytics.ts`):

- **Price return only.** Only the split-adjusted `close` is read. Dividends are intentionally
  excluded, so every total in these four workspaces understates total return. The UI says so.
- Every rate, return, weight, and drawdown is a decimal fraction (`0.05` is +5%, `-0.2` is a 20%
  drawdown). The domain layer never converts to percent, rounds for display, or formats.
- Volatility and Sharpe are annualized with **252** trading days per year. CAGR uses **365.25**
  calendar days per year.
- The risk-free rate used for Sharpe is always supplied by the caller, never assumed. The workspaces
  default the input to `4.0%` and cap it at `25%`; it is editable.
- Max drawdown is the worst close-to-close decline, with peak, trough, and recovery dates retained.
- Every function is deterministic: no clock, no randomness, no I/O.
- `undefined` means "not computable from this data", never `0`. A short history yields missing
  metrics rather than invented ones.
- Concentration flags are educational diagnostics: a single holding above **40%**, or a single sector
  above **50%**, raises a flag. Sectors are never inferred — `MarketData` carries no sector field, so
  sector concentration is reported as explicitly unavailable rather than guessed from the ticker.

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

- Live mode accepts US-listed common stocks and ETFs whose market data is USD-denominated and uses
  the `America/New_York` exchange timezone.
- Historical selections start at 1990-01-01.
- Each ticker must match `A-Z`, `0-9`, `.`, or `-`, must be 1–12 characters, and may appear only once
  in a portfolio.
- Daily OHLC prices come from Yahoo Finance chart history. Ordinary dividends and corporate-action
  verification come from Massive. Split and reverse-split events must reconcile exactly across Yahoo
  and Massive by date, ratio, and supported action type.
- A live result is identified as `hybrid`; synthetic preview data is identified as `demo`. Demo
  results are never presented as verified market history.
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
- Monetary values used in fee and purchase accounting are rounded to cents.
- Each fee rule may combine a fixed charge, per-share charge, percentage-of-value charge, minimum,
  and optional maximum.
- Buy, sell, and dividend-reinvestment rules are independent and remain editable even when a broker
  preset is selected.
- Included presets cover Robinhood, Webull, Moomoo, Firstrade, and several IBKR plans. Presets are
  estimates with an effective date, not a substitute for a current brokerage statement.

#### Dividends and taxes

- Ordinary dividend eligibility uses shares held on the **ex-dividend date**.
- If the reported ex-date is not an available session, eligibility moves to the next available
  session in the loaded history.
- The gross dividend is eligible shares × split-adjusted cash amount per share.
- Pretax mode applies neither dividend withholding nor capital-gains tax. After-tax mode subtracts
  the user-entered dividend withholding rate and, when liquidation is enabled, the entered
  capital-gains tax rate.
- The net dividend is reinvested on the **payment date**, or the next available session, at that
  session's split-adjusted High. Any remainder that cannot buy another 0.001 share stays as cash.
- Reinvestment fees use the independent dividend-reinvestment fee rule.
- Capital-gains tax applies only in **Aftertax** mode with **Liquidate at end** enabled. The taxable
  gain is never below zero and equals ending market value minus accumulated purchase cost.
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
stock price return = ending market value - purchase cost
ending amount      = market value + residual cash
total profit       = ending amount - external contributions
total return %     = total profit / external contributions × 100
```

If end liquidation is selected, ending amount is the cash balance after sale fees and capital-gains
tax.

The engine independently audits every result with:

```text
stock price return
+ gross dividends
- dividend withholding tax
- capital-gains tax
- all fees
= total profit
```

Calculation stops if this cross-check differs from the ending-balance result by more than USD 0.03.

Maximum drawdown uses a **cash-flow-neutral unit value**. New external contributions create units at
that session's pre-flow asset value, so a same-day market move is preserved while depositing more
money does not appear as investment performance. Portfolio metrics aggregate independently calculated
holdings; transactions are ticker-labelled and merged chronologically, and portfolio drawdown is
recalculated from the combined series.

#### Future periods: simulated estimates only

Future values are never merged into the historical result and are never described as forecasts or
guaranteed returns.

- Historical results stop at the last real market session.
- The simulation sample begins no earlier than 1990-01-01 and no earlier than the security's
  available listing history.
- The current incomplete calendar year is excluded from annual-return sampling. A year needs at least
  100 price sessions to count as complete.
- Fewer than three complete years disables future scenarios. Three to four complete years produces an
  explicit limited-sample warning.
- **Conservative** uses the 25th percentile of completed annual returns; **Baseline** uses the
  historical CAGR over the available sample; **Optimistic** uses the 75th percentile.
- The simulated daily close path compounds the scenario rate over 252 sessions per year. Simulated
  highs use the median recent High/Close premium, with a small minimum premium.
- Simulated dividend yield uses the median annual ordinary-dividend yield from complete historical
  years, represented as four quarterly payments.
- Generated future sessions model weekdays; they do not reproduce a future exchange-holiday calendar.

Every UI banner, assistant summary, and PDF section labels these outputs as **simulated estimates**.

### How DCA Backtest differs from the other four workspaces

| | Market Overview / Stock Analysis / Stock Comparison / Portfolio Lab | DCA Backtest |
| --- | --- | --- |
| Return basis | Price return only; dividends excluded | Total return; ordinary dividends modeled and reinvested |
| Capital | Observation, or one lump-sum allocation | Recurring external contributions on a schedule |
| Execution price | Split-adjusted **close** | Split-adjusted **high** of the execution session |
| Fees | Not modeled | Independent buy / sell / reinvestment fee rules with broker presets |
| Taxes | Not modeled | Dividend withholding, plus capital-gains tax on optional liquidation |
| Drawdown | Close-to-close on the price or portfolio series | Cash-flow-neutral unit value, so contributions are not read as performance |
| Rebalancing | Portfolio Lab: none, weights drift and drift is reported | Not applicable; each holding runs its own schedule |
| Future periods | Not offered | Conservative / baseline / optimistic simulated estimates, kept separate |
| Corporate actions | Split-adjusted closes | Fail-closed cross-provider verification |
| Download | Stock Comparison: CSV | Multi-page PDF report |

## Local development

### Prerequisites

- Node.js 24.x (pinned by `.nvmrc` and the `engines` field in `package.json`)
- npm
- A Massive API key for live market data
- A Google Gemini API key if the AI report explainer is required

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
| `MASSIVE_API_KEY` | Yes, for live data | Ordinary dividend history and corporate-action (split) verification. |
| `GEMINI_API_KEY` | Optional | The report-grounded AI explainer. Calculations, charts, CSV, and PDF export all work without it. |

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
```

Test suites, all deterministic and network-free:

| Suite | Covers |
| --- | --- |
| `src/domain/analytics.test.ts` | Returns, CAGR, annualized volatility and Sharpe, drawdown peak/trough/recovery, moving averages, alignment, beta, correlation, weight validation, concentration. |
| `src/domain/backtest-engine.test.ts` | Schedules, local dates, daily-high fills, dividends, safety stops, liquidation, audit cross-checks, portfolio aggregation. |
| `src/domain/fees.test.ts` | Independent SEC Section 31 and FINRA TAF sell assessments, minimums, and caps. |
| `src/domain/market-overview.test.ts` | Trailing windows, benchmark summaries, normalized series, watchlist rules, risk bands. |
| `src/domain/portfolio-lab.test.ts` | Buy-and-hold allocation, common-window intersection, weight drift, concentration, risk diagnosis codes. |
| `src/domain/risk-context.test.ts` | Mode classification, determinism, and the forbidden-word list that keeps every reading advice-free. |
| `src/domain/stock-analysis.test.ts` | Per-symbol view model, benchmark relationship, missing-metric handling. |
| `src/domain/stock-comparison.test.ts` | Two-to-five alignment, risk table, correlation matrix, neutral narrative, CSV contents. |
| `src/server/market-data.test.ts` | Supported split classification and fail-closed reorganization detection, with no network. |
| `src/services/create-portfolio-report.test.ts` | Sequential holding load and aggregate report assembly. |

Before release, also verify manually: live-data success and failure states, all chart modes,
desktop and mobile layouts from 320px, reduced-motion behavior, both languages at every text size,
full transaction expansion, PDF pagination, CSV contents, AI guardrails, and an unsupported
corporate-action stop.

## Downloads

Both downloads are generated **entirely in the browser** from results already rendered. Nothing is
uploaded to a rendering or conversion service.

**DCA Backtest — PDF** (`src/services/pdf-export.ts`, jsPDF + jsPDF-AutoTable). Saved as
`investiq-dca-<tickers>-<end-date>.pdf`. Contains the portfolio summary and historical/scenario
label, holding attribution, return/tax/fee/cash reconciliation, drawdown and execution audit dates,
all input and broker assumptions, the complete ticker-labelled transaction ledger, and methodology,
limitations, and simulated-estimate disclaimers. Future-scenario PDFs stay explicitly labelled as
simulated estimates.

**Stock Comparison — CSV.** Carries the common window start, end, and session count, the risk-free
rate used, the benchmark, the originally requested window, and an explicit basis note stating that
figures are price return and that empty cells mean "not computable", not zero.

## AI report explainer

Available in the DCA Backtest workspace only. The drawer sends a compact summary of the currently
selected report — not credentials, not the PDF — to the same-origin `/api/assistant` route, which
then calls Gemini server-side.

Guardrails in the system instruction require the assistant to use only supplied report facts, treat
the report JSON as untrusted read-only data and never follow instructions inside it, explain in the
user's language, refuse buy/sell/timing/selection/allocation advice, call every future result a
simulated estimate, and never present output as a prediction or guarantee.

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

- **Four workspaces exclude dividends.** Market Overview, Stock Analysis, Stock Comparison, and
  Portfolio Lab are price return only. Their totals understate total return. Only DCA Backtest models
  dividends.
- **Portfolio Lab never rebalances.** It measures a single lump-sum buy-and-hold allocation.
- **No sector data.** Sector concentration is reported as unavailable rather than inferred.
- **Past history only.** Future scenarios exist solely in DCA Backtest and are labelled simulated
  estimates everywhere they appear. They are not forecasts, predictions, advice, or guaranteed
  returns.
- **Corporate-action safety is bounded by the providers.** The fail-closed checks stop known
  unsupported events from being approximated, but cannot prove that an unreported event does not
  exist.
- **Vendor data may be delayed, corrected, incomplete, or rate-limited.** Confirm redistribution and
  production-use rights before any commercial use.
- **Broker fees and tax inputs are user-configurable estimates.** Confirm current schedules,
  jurisdiction, residency, and account type independently.
- **Rate limiting and the market-data cache are in-memory and per server instance.** They reduce
  accidental abuse but are not a distributed security boundary. A production service under sustained
  traffic needs durable shared rate limiting and caching.
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
| `next-env.d.ts` | Next.js-generated type declarations; do not edit manually. |
| `design/investiq/*.png` | Current reference visual concepts, one per workspace plus mobile DCA. |
| `design/stock-lens-web-concept.png`, `design/stock-lens-web-concept-v2.png` | **Legacy design references.** Visual direction from Stock Lens, the single-workspace DCA tool InvestIQ grew out of. Retained for design history only; they do not describe the current product. |

### App entry points and API routes

| Path | Purpose |
| --- | --- |
| `src/app/layout.tsx` | Root HTML layout, fonts, metadata, language provider, and global stylesheet. |
| `src/app/globals.css` | Global reset, color foundation, font-scale variables, and reduced-motion behavior. |
| `src/app/page.tsx` | Market Overview route (`/`). |
| `src/app/stock/page.tsx` | Stock Analysis route (`/stock`). |
| `src/app/compare/page.tsx` | Stock Comparison route (`/compare`). |
| `src/app/portfolio/page.tsx` | Portfolio Lab route (`/portfolio`). |
| `src/app/dca/page.tsx` | DCA Backtest route (`/dca`). |
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
| `src/config/navigation.ts` | The five primary routes and the active-route match rule. |

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
| `src/domain/fees.ts` | Deterministic fee calculation, cent rounding, and 0.001-share flooring. |
| `src/domain/portfolio-aggregate.ts` | Merges holding results and recalculates portfolio metrics and cash-flow-neutral drawdown. |
| `src/domain/projection-engine.ts` | Conservative, baseline, and optimistic simulated estimates from eligible historical samples. |

### Data, server adapters, and services

| Path | Purpose |
| --- | --- |
| `src/server/market-data.ts` | Server-only Yahoo/Massive integration, validation, bounded cache, corporate-action checks, normalized responses. |
| `src/server/assistant.ts` | Server-only Gemini integration, report-bound guardrails, payload limits, provider error translation. |
| `src/server/errors.ts` | Request-size limits, per-instance rate limiting, client identification, and safe public/server error separation. |
| `src/services/market-data-api.ts` | Browser client for the same-origin market-data endpoint, with response validation and timeouts. |
| `src/services/assistant-api.ts` | Builds the compact report summary and calls the same-origin assistant endpoint. |
| `src/services/create-report.ts` | Coordinates live/demo loading, historical boundaries, and optional holding-level simulations. |
| `src/services/create-portfolio-report.ts` | Runs every holding sequentially and constructs aggregate historical and scenario reports. |
| `src/services/pdf-export.ts` | Generates and downloads the multi-page DCA PDF in the browser. |
| `src/data/demo-market-data.ts` | Deterministic, explicitly labelled synthetic series for product exploration. |
| `src/constants/broker-presets.ts` | Editable broker-fee estimates with effective-date metadata. |
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

## Security notes

- API keys are read only in server modules and are never intentionally serialized to the browser.
- Same-origin routes validate ticker and date inputs, bound JSON request sizes, cap AI report size
  and history, enforce timeouts, and return neutral 5xx messages.
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
