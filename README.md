# Stock Lens Web

Stock Lens is a professional portfolio backtesting workspace for recurring investments in US-listed common stocks and ETFs. It combines auditable execution rules, dividend reinvestment, taxes, broker fees, portfolio-level drawdown, complete PDF reporting, and a report-grounded AI explainer in one responsive Next.js application.

The application is research software. It does not place trades, provide investment or tax advice, or guarantee that market data and broker schedules are complete or unchanged.

## Product capabilities

- Model a portfolio of one or two unique US stock or ETF tickers per verified run. The launch cap keeps provider-backed corporate-action checks within reliable request limits while still supporting multi-asset portfolios.
- Invest either a fixed USD amount or a fixed number of shares per order.
- Run orders every Day, Week, Month, or Year with a configurable interval.
- Use fractional shares, always rounded down to 0.001 share.
- Execute recurring purchases at the selected session's split-adjusted daily high.
- Roll scheduled non-trading dates forward to the next available trading session.
- Reinvest ordinary cash dividends on the payment date while preserving ex-date eligibility.
- Compare pretax and after-tax reporting, with editable dividend withholding and optional liquidation tax rates.
- Select an editable broker-fee preset or enter a custom fee schedule.
- Inspect value, cash-flow-neutral return, drawdown, holding attribution, and the complete transaction ledger.
- Keep historical backtests separate from conservative, baseline, and optimistic future simulated estimates.
- Export a complete multi-page PDF report in the browser.
- Ask a Gemini-powered assistant to explain the active report without giving trading advice.
- Explore the complete interface with clearly marked synthetic demo data when live data is unavailable.
- Use a responsive, animated interface with reduced-motion support.

## Calculation contract

The rules below are part of the product contract. Changes to these rules should be accompanied by regression tests and corresponding updates to the PDF methodology.

### Supported instruments and data window

- Live mode accepts US-listed common stocks and ETFs whose market data is USD-denominated and uses the `America/New_York` exchange timezone.
- The current product interface starts historical selections at 1990-01-01.
- Each ticker must match `A-Z`, `0-9`, `.`, or `-`, must contain 1–12 characters, and may appear only once in a portfolio.
- Daily OHLC prices come from Yahoo Finance chart history. Ordinary dividends and corporate-action verification come from Massive. Split and reverse-split events must reconcile exactly across Yahoo and Massive by date, ratio, and supported action type.
- A live result is identified as `hybrid`; synthetic preview data is identified as `demo`. Demo results must never be presented as verified market history.
- Historical calculation ends on the last available market session on or before the requested end date. If the requested period contains no valid session, calculation stops.

### Recurring schedule and execution

Every schedule starts from the requested start date.

- **Day:** means available trading sessions, not calendar days. Every `N` Day selects every Nth available session beginning with the first session on or after the start date.
- **Week:** due dates advance in seven-calendar-day increments from the original start date.
- **Month:** due dates preserve the original day where possible and clamp to the final day of shorter months.
- **Year:** due dates preserve the month and day where possible and clamp invalid leap-day dates.
- For Week, Month, and Year schedules, a due date that is not a market session moves forward to the next available session within the selected window.
- Each contribution purchase uses that execution session's split-adjusted **High**. It does not use the close, low, midpoint, or an assumed intraday timestamp.
- Period-end holdings are valued at the final session's split-adjusted **Close** unless end liquidation is enabled.

### Cash orders, share orders, precision, and fees

- **USD order:** the configured cash amount is an external contribution. The engine deducts the calculated buy fee, buys the maximum affordable quantity, and retains any uninvested remainder as cash.
- **Share order:** the configured share quantity is rounded down to 0.001 share. The external contribution equals shares × execution price + the calculated buy fee.
- Share quantities are always floored—not rounded to nearest—to three decimal places.
- Monetary values used in fee and purchase accounting are rounded to cents.
- Each fee rule may combine a fixed charge, per-share charge, percentage-of-value charge, minimum, and optional maximum.
- Buy, sell, and dividend-reinvestment rules are independent and remain editable even when a broker preset is selected.
- Included presets cover Robinhood, Webull, Moomoo, Firstrade, and several IBKR plans. Presets are estimates with an effective date, not a substitute for a current brokerage statement.

### Dividends and taxes

- Ordinary dividend eligibility is captured using shares held on the ex-dividend date.
- If the reported ex-date is not an available session, eligibility moves to the next available session in the loaded history.
- The gross dividend is eligible shares × split-adjusted cash amount per share.
- Pretax mode applies neither dividend withholding nor capital-gains tax. After-tax mode subtracts the user-entered dividend withholding rate and, when liquidation is enabled, the entered capital-gains tax rate.
- The net dividend is reinvested on the payment date, or the next available session, at that session's split-adjusted High.
- Any remainder that cannot buy another 0.001 share stays as cash.
- Reinvestment fees use the independent dividend-reinvestment fee rule.
- Capital-gains tax is applied only in **Aftertax** mode when **Liquidate at end** is enabled. The taxable gain is never below zero and is calculated as ending market value minus accumulated purchase cost.
- End liquidation sells at the final session's Close and applies the sell fee; it also applies the entered capital-gains tax rate only in Aftertax mode.

### Corporate actions and data-integrity stops

- Split-adjusted OHLC allows forward and reverse splits to be represented without embedding dividend reinvestment in the price series.
- Ordinary dividends are modeled separately so they are not double counted.
- Special/non-recurring dividends, capital-gain distributions, returns of capital, fractional stock-dividend adjustments, malformed actions, and any unsupported provider-reported company event stop the calculation. A standard integer-forward split legally effected as a stock dividend is accepted only when Yahoo and Massive match exactly on date and ratio.
- Mergers, acquisitions, spin-offs, security exchanges, rights, and warrants are not silently approximated. When an event cannot be handled reliably, the user receives a corporate-action safety error instead of a numerical result.
- Missing or non-finite OHLC data also stops calculation.

This is a fail-closed design, but it is limited by what upstream providers report. A missing provider event cannot be detected locally.

### Returns, balances, and drawdown

For each holding:

```text
stock price return = ending market value - purchase cost
ending amount      = market value + residual cash
total profit       = ending amount - external contributions
total return %     = total profit / external contributions × 100
```

If end liquidation is selected, ending amount is the cash balance after sale fees and capital-gains tax.

The engine independently audits the result with:

```text
stock price return
+ gross dividends
- dividend withholding tax
- capital-gains tax
- all fees
= total profit
```

Calculation stops if this cross-check differs from the ending-balance result by more than USD 0.03.

Maximum drawdown uses a cash-flow-neutral unit value. New external contributions create units at that session's pre-flow asset value, so a same-day market move is preserved while depositing more money does not appear as investment performance. Drawdown is the largest percentage decline from a prior unit-value peak to a subsequent trough; peak, trough, and recovery dates are retained.

Portfolio metrics aggregate independently calculated holdings. Transactions are ticker-labelled and merged chronologically, and portfolio drawdown is recalculated from the combined cash-flow-neutral series.

### Future periods: simulated estimates only

Future values are never merged into the historical result and are never described as forecasts or guaranteed returns.

- Historical results stop at the last real market session.
- The simulation sample begins no earlier than 1990-01-01 and no earlier than the security's available listing history.
- The current incomplete calendar year is excluded from annual-return sampling.
- A year needs at least 100 price sessions to count as complete.
- Fewer than three complete years disables future scenarios. Three to four complete years produces an explicit limited-sample warning.
- **Conservative** uses the 25th percentile of completed annual returns.
- **Baseline** uses the historical CAGR over the available sample.
- **Optimistic** uses the 75th percentile of completed annual returns.
- The simulated daily close path compounds the scenario rate over 252 sessions per year. Simulated highs use the median recent High/Close premium, with a small minimum premium.
- Simulated dividend yield uses the median annual ordinary-dividend yield from complete historical years and is represented with four quarterly payments.
- Generated future sessions currently model weekdays; they do not reproduce a future exchange-holiday calendar.

Every UI banner, assistant summary, and PDF section labels these outputs as **simulated estimates** and keeps them separate from historical performance.

## Architecture

Stock Lens uses a single Next.js App Router deployment:

```text
Browser UI
  ├─ same-origin POST /api/market-data
  │    ├─ Yahoo Finance: daily OHLC, instrument metadata, split events
  │    └─ Massive: dividends and dedicated split verification
  ├─ pure TypeScript calculation engine in the browser
  ├─ browser-local PDF generation
  └─ same-origin POST /api/assistant
       └─ Google Gemini: compact, report-grounded explanation
```

Vendor credentials stay in server-only environment variables. The browser receives validated market data and a neutral public error; it never receives API keys.

### Technology

- Next.js 16 App Router and React 19
- TypeScript in strict mode
- Motion for interface transitions and count-up behavior
- Recharts for value, return, and drawdown charts
- jsPDF and jsPDF-AutoTable for complete client-side reports
- Vitest for deterministic domain regression tests
- ESLint with Next.js Core Web Vitals and TypeScript rules

## File map

### Project root

| Path | Purpose |
| --- | --- |
| `README.md` | Product contract, architecture, setup, verification, deployment, and security notes. |
| `package.json` | Runtime requirements, scripts, and production/development dependencies. |
| `package-lock.json` | Reproducible npm dependency lockfile. |
| `.nvmrc` | Expected local Node.js major version (`24`). |
| `.env.example` | Local environment-variable name template; contains no production values. |
| `.gitignore` | Excludes dependencies, builds, environment files, Vercel linkage, and generated TypeScript state. |
| `next.config.ts` | Next.js configuration and allowed local development origins. |
| `tsconfig.json` | Strict TypeScript settings and the `@/*` → `src/*` import alias. |
| `vitest.config.ts` | Vitest runtime and matching source alias. |
| `eslint.config.mjs` | Next.js Core Web Vitals and TypeScript lint configuration. |
| `vercel.json` | Pins the Vercel framework preset to Next.js so server routes and build output are deployed correctly. |
| `next-env.d.ts` | Next.js-generated type declarations; do not edit manually. |
| `design/stock-lens-web-concept.png` | Approved full-screen visual direction used to guide the dashboard implementation. |
| `public/` | Reserved for future static web assets; the app currently uses the branded icon under `src/app/`. |
| `output/` | Local browser/PDF verification artifacts; not required at runtime. |
| `tmp/` | Temporary PDF-render inspection files; not required at runtime. |

Generated directories such as `.next/`, `node_modules/`, `.vercel/`, and `.playwright-cli/` are local tooling state and are not source code.

### App entry points and API routes

| Path | Purpose |
| --- | --- |
| `src/app/layout.tsx` | Root HTML layout, Geist fonts, metadata, and global stylesheet registration. |
| `src/app/page.tsx` | Server page entry that mounts the Stock Lens dashboard. |
| `src/app/globals.css` | Global reset, color foundation, and reduced-motion behavior. |
| `src/app/icon.svg` | Branded browser and application icon selected by the app metadata. |
| `src/app/favicon.ico` | Legacy favicon fallback retained for broad browser compatibility. |
| `src/app/api/health/route.ts` | Reports market-data and assistant configuration readiness without exposing credentials. |
| `src/app/api/market-data/route.ts` | Rate-limited, same-origin market-data POST endpoint with validation and neutral error handling. |
| `src/app/api/assistant/route.ts` | Rate-limited, same-origin Gemini POST endpoint with request validation and neutral error handling. |

### Interface components

| Path | Purpose |
| --- | --- |
| `src/components/stock-lens-dashboard.tsx` | Complete portfolio builder, live/demo execution workflow, result panels, animated metrics, attribution, transactions, methodology, PDF action, and AI drawer. |
| `src/components/stock-lens-dashboard.module.css` | Responsive institutional visual system for the dashboard, drawers, tables, controls, and mobile layouts. |
| `src/components/portfolio-performance-chart.tsx` | Interactive value/return/drawdown chart with 1Y, 3Y, and full-history ranges. |

### Domain and calculation engine

| Path | Purpose |
| --- | --- |
| `src/domain/backtest-engine.ts` | Pure holding-level accounting engine for orders, dividends, fees, taxes, liquidation, audit checks, and drawdown. |
| `src/domain/schedule.ts` | Converts recurring Day/Week/Month/Year rules into available execution sessions. |
| `src/domain/fees.ts` | Deterministic fee calculation, cent rounding, and 0.001-share flooring. |
| `src/domain/fees.test.ts` | Regression coverage for independent SEC Section 31 and FINRA TAF sell assessments and caps. |
| `src/domain/portfolio-aggregate.ts` | Merges holding results and recalculates portfolio metrics and cash-flow-neutral drawdown. |
| `src/domain/projection-engine.ts` | Builds conservative, baseline, and optimistic future simulated estimates from eligible historical samples. |
| `src/domain/backtest-engine.test.ts` | Regression coverage for schedules, local dates, daily-high fills, dividends, safety stops, liquidation, cross-checks, and portfolio aggregation. |

### Data, server adapters, and services

| Path | Purpose |
| --- | --- |
| `src/server/market-data.ts` | Server-only Yahoo/Massive integration, validation, six-hour bounded Massive cache, corporate-action checks, and normalized response construction. |
| `src/server/market-data.test.ts` | No-network regression coverage for supported split classification and fail-closed reorganization detection. |
| `src/server/assistant.ts` | Server-only Gemini integration, report-bound system guardrails, payload limits, and provider error translation. |
| `src/server/errors.ts` | Request-size limits, per-instance rate limiting, client identification, JSON responses, and safe public/server error separation. |
| `src/services/market-data-api.ts` | Browser client for the same-origin market-data endpoint, including response validation and timeouts. |
| `src/services/assistant-api.ts` | Builds a compact report summary and calls the same-origin assistant endpoint. |
| `src/services/create-report.ts` | Coordinates live/demo loading, historical boundaries, and optional holding-level simulations. |
| `src/services/create-portfolio-report.ts` | Runs all holdings and constructs aggregate historical and scenario reports. |
| `src/services/pdf-export.ts` | Generates and downloads the complete multi-page PDF in the browser. |
| `src/data/demo-market-data.ts` | Deterministic, explicitly labelled synthetic price and dividend series for product exploration. |
| `src/constants/broker-presets.ts` | Editable broker-fee estimates and effective-date metadata. |
| `src/types/backtest.ts` | Shared contracts for inputs, market data, transactions, results, projections, and reports. |
| `src/utils/date.ts` | UTC-safe market-date arithmetic plus local date-input round trips. |
| `src/utils/format.ts` | Central USD, percentage, share, and numeric-input formatting. |

## Local development

### Prerequisites

- Node.js 24.x (`.nvmrc` and `package.json` enforce this major version)
- npm
- A Massive API key for live data
- A Gemini API key if the AI report explainer is required

### Install and configure

```bash
nvm use
npm ci
cp .env.example .env.local
```

Set only these names in `.env.local`:

```dotenv
MASSIVE_API_KEY=
GEMINI_API_KEY=
```

- `MASSIVE_API_KEY` is required for live backtests and corporate-action verification.
- `GEMINI_API_KEY` is optional for calculations and PDF export, but required for the AI assistant.
- Do not prefix either variable with `NEXT_PUBLIC_`; both are server-only credentials.
- Never commit `.env.local` or paste credential values into issues, logs, screenshots, PDFs, or chat transcripts.

Start the development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The initial dashboard uses a clearly marked synthetic preview. Select **Run live backtest** to request verified data.

Service readiness is available at:

```text
GET http://localhost:3000/api/health
```

It reports only `ready`, `degraded`, or `unavailable` states; it never returns key values.

## Quality checks

Run the complete local gate:

```bash
npm run check
npm run build
```

Individual commands:

```bash
npm run typecheck  # TypeScript, no output
npm run lint       # Next.js and TypeScript lint rules
npm run test       # Deterministic Vitest domain tests
npm run build      # Production Next.js build
npm run start      # Serve a completed production build
```

The current automated suite covers:

- weekend/monthly rollover to the next available session;
- local date-input stability across timezones;
- daily-high purchase execution and accounting balance;
- ex-date entitlement and pay-date dividend reinvestment;
- fail-closed special-dividend handling;
- peak/trough/recovery drawdown;
- optional liquidation fees and capital-gains tax; and
- multi-holding aggregation and ticker-labelled transactions.

Before release, also verify live-data success and failure states, all chart modes, desktop/mobile layouts, reduced-motion behavior, full transaction expansion, PDF pagination, AI guardrails, and an unsupported corporate-action stop.

## PDF report

**Export PDF** generates the report entirely in the browser with jsPDF. Report data is not sent to a PDF service.

The report includes:

- portfolio summary and selected historical/scenario label;
- holding attribution;
- return, tax, fee, and cash reconciliation;
- drawdown and execution audit dates;
- all input and broker assumptions;
- the complete ticker-labelled transaction ledger; and
- methodology, limitations, and simulated-estimate disclaimers.

Future-scenario PDFs remain explicitly labelled as simulated estimates and are not represented as forecasts.

## AI report explainer

The AI drawer sends a compact summary of the currently selected report—not credentials or the PDF—to the same-origin `/api/assistant` route. The server then calls `gemini-3.1-flash-lite`.

Guardrails require the assistant to:

- use only supplied report facts;
- treat report JSON as untrusted read-only data;
- explain results in the user's language;
- avoid buy, sell, timing, selection, and allocation advice;
- call every future result a simulated estimate; and
- avoid presenting any output as a prediction or guarantee.

Questions are limited to 500 characters, recent conversation context is bounded, the serialized report summary is size-limited, and provider requests time out. The AI output is explanatory text and should still be treated as model-generated content.

## Publish to GitHub

Confirm that no environment file is staged before the first push:

```bash
git status --short
git check-ignore .env.local
```

For a new private repository with GitHub CLI:

```bash
git init
git add .
git commit -m "feat: launch Stock Lens web"
gh repo create stock-lens-web --private --source=. --remote=origin --push
```

For an existing repository:

```bash
git add .
git commit -m "docs: update Stock Lens"
git push
```

The current `.gitignore` excludes all `.env*` files except the intentionally value-free `.env.example` template. Never allow `.env.local` or any credential-bearing environment file into version control.

## Deploy to Vercel

The repository is a standard Next.js project and requires no custom build command. Vercel should use `npm run build` and the Node.js version declared in `package.json`.

### CLI deployment

```bash
npm install --global vercel
vercel login
vercel link
```

Add credentials through the encrypted Vercel prompt or dashboard. Do not place values in shell history:

```bash
vercel env add MASSIVE_API_KEY production
vercel env add GEMINI_API_KEY production
vercel env add MASSIVE_API_KEY preview
vercel env add GEMINI_API_KEY preview
```

Create and verify a preview deployment:

```bash
vercel deploy
```

Promote a verified build to production:

```bash
vercel deploy --prod
```

After deployment, check `/api/health`, run at least one live ticker through the full result workflow, export a PDF, and ask the assistant a report question. A successful page render alone does not verify vendor credentials or outbound provider access.

### Git integration

Alternatively, import the private GitHub repository in Vercel, configure `MASSIVE_API_KEY` and `GEMINI_API_KEY` in Project Settings → Environment Variables, and deploy the production branch. Pull requests then receive isolated preview deployments.

## Security and operational notes

- API keys are read only in server modules and are never intentionally serialized to the browser.
- Same-origin routes validate ticker/date inputs, bound JSON request sizes, cap AI report size and history, enforce timeouts, and return neutral 5xx messages.
- Current rate limiting and the Massive response cache are in-memory and per server instance. They reduce accidental abuse but are not a distributed security boundary. A production service under sustained traffic should use durable, shared rate limiting and caching.
- Upstream requests currently include the Massive key as required by that provider. Server logs and observability exports must redact request URLs and authorization material.
- PDF generation is local, but AI explanations send the compact report summary to Google Gemini. Review provider privacy, retention, and regional requirements before handling sensitive portfolios.
- Do not place secrets in `NEXT_PUBLIC_*`, source code, Git history, client error messages, screenshots, or analytics events.
- Broker fees and tax inputs are user-configurable estimates. Confirm current schedules, jurisdiction, residency, and account type independently.
- Yahoo and Massive data may be delayed, corrected, incomplete, rate-limited, or subject to licensing restrictions. Confirm redistribution and production-use rights before commercial launch.
- Corporate-action safety depends on upstream event coverage. The fail-closed checks prevent known unsupported events from being approximated but cannot prove that an unreported event does not exist.
- Stock Lens is educational research software—not a broker, execution venue, investment adviser, tax professional, or source of guaranteed performance.
