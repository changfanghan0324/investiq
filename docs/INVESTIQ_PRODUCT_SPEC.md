# InvestIQ product specification

## Product position

InvestIQ is an educational **Investment Research & Portfolio Analytics Platform** for US-listed
companies and ETFs. It helps finance students, aspiring research analysts, asset-management interns,
and self-directed investors turn source data into a documented investment view.

The primary question is not “how much money will I have?” It is:

> What do reported fundamentals, explicit valuation assumptions, and portfolio risk say about this
> investment case—and which conclusions remain uncertain?

Historical DCA and growth calculators are supporting tools. They must never dominate the research
home or be presented as the platform's investment conclusion.

## Personas and jobs to be done

1. **Aspiring investment analyst / finance student (primary).** Needs a portfolio-quality research
   process, visible formulas, and source receipts without institutional terminals.
2. **Early-career portfolio analyst (secondary).** Needs aligned multi-asset risk metrics,
   attribution, benchmark context, and reproducible exports.
3. **International beginner (accessibility persona).** Needs plain-language English or Simplified
   Chinese explanations and the ability to open details only when ready.

## Information architecture

Primary navigation contains exactly four destinations: Research, Compare, Portfolio, Tools.

- `/` — ticker-first Research launcher; recent browser-local work; no overloaded market dashboard.
- `/company/[ticker]` — Company Summary, capped at five decision-relevant outputs.
- `/company/[ticker]/financials` — detailed annual filing analysis and source receipts.
- `/company/[ticker]/valuation` — DCF, sensitivities, scenario range, and user-sourced comparables.
- `/company/[ticker]/memo` — one-page evidence-linked memo and print/PDF workflow.
- `/company/[ticker]/report` — full bilingual Equity Research Report with financial history,
  ratio diagnostics, DCF assumptions/scenarios, SEC filing register, limitations, and print pagination.
- `/compare` — two to five securities on one common return calendar.
- `/portfolio` — one to ten holdings, user/equal/inverse-volatility weights and portfolio risk.
- `/tools` — secondary market and calculator tools.
- `/tools/dca` — historical recurring-investment backtest; no future estimates.
- `/market`, `/methodology` — contextual destinations outside primary navigation.

## Functional acceptance criteria

### Company Summary

- Loads a valid US ticker through a server-owned SEC adapter.
- Shows revenue, operating margin, constructed FCF, dated price-risk context, and a deterministic
  historical interpretation—no more than five first-level outputs.
- Every annual fact retains taxonomy, concept, filing date, accession, period, and filing URL.
- Missing data remains unavailable; the UI never converts missing data to zero.

### Financial Analysis

- Shows up to five latest-reported annual periods for growth, profitability, cash generation, and
  supported health metrics.
- Revenue/net income/EPS/FCF show CAGR only when positive endpoints and a valid span support it.
- Margin change is shown in percentage points, not CAGR.
- Unsupported gross margin, ROIC, debt/liquidity, efficiency, sector, and financial-industry metrics
  carry explicit coverage gates.

### Valuation

- Five-year unlevered FCFF DCF with editable revenue growth, operating margin, cash tax, D&A, CapEx,
  ΔNWC, WACC, terminal growth, and net debt.
- Displays bear/base/bull range before base implied price, two 5×5 sensitivity tables, full forecast,
  terminal bridge, and EV→equity bridge.
- Current price comparison is separate and includes a quote date.
- Comparable method applies user-researched P/E, EV/Revenue, or EV/EBITDA ranges; InvestIQ does not
  invent peers or medians.
- Never uses “fair value,” “price target,” “prediction,” “guarantee,” or buy/sell language.

### Portfolio Analytics

- One to ten distinct, long-only holdings; weights must visibly total exactly 100%.
- User-defined and equal weights are available before a run. Inverse-volatility weights become
  available only after every holding has sufficient, non-zero measured volatility.
- Outputs return, CAGR, annualized volatility, Sharpe, Sortino, beta, Jensen-style alpha, maximum
  drawdown, historical one-day VaR, correlation, holding attribution, weight drift, and concentration.
- Common-date alignment, return basis, sample size, benchmark overlap, and unavailable metrics are
  visible. Sector exposure is withheld until a trusted sector source exists.

### Investment Memo

- One-page record containing company overview, financial evidence, thesis, catalysts, risks,
  valuation range, conclusion, and filing receipt.
- Reported facts, model assumptions, and user-authored interpretation remain visually distinct.
- Saves notes and the last valuation snapshot only in the browser; no account or analytics tracking.
- A dedicated print stylesheet supports CJK-safe browser Save as PDF without sending report contents
  to another service; Chromium print output is visually and text-extraction tested in both languages.

## Data and model governance

- SEC annual facts are latest-reported/restatement-aware and grouped by economic period, not filing
  fiscal-year metadata. Annual flow periods are 350–380 days; direct and constructed metrics have
  explicit unit and component contracts.
- Company fundamentals are display-only. Historical market analysis never mixes latest filing data
  backward into price history.
- Analytics use one return basis per view: vendor adjusted-close total-return proxy only when every
  leg has complete coverage; otherwise price return for every leg.
- Volatility, Sharpe, Sortino, VaR, beta, alpha, and correlation require at least 60 aligned daily
  returns. Under 252 is disclosed as a limited sample.
- Future DCA estimates are disabled. An unreachable experimental engine is not a product feature.
- All calculations are deterministic, preserve internal precision, and return unavailable instead
  of an invented zero.

## Experience requirements

- English and Simplified Chinese only; language selector shows 🇺🇸 and 🇨🇳.
- Text-size choices 25/50/75/100 with 25 as default; layouts remain usable at 100.
- Professional low-saturation dark interface: thin borders, restrained blue/teal status color,
  limited radius, mono numerics, no glassmorphism or neon gradients.
- Keyboard operation, visible focus, labelled landmarks, text equivalents for charts, reduced-motion
  support, and table-local horizontal scrolling.
- Mobile layouts work from 320 px; company tabs and primary navigation remain reachable.

## Delivery standard

- Public GitHub repository and Vercel deployment.
- Passing typecheck, lint, deterministic unit tests, production build, and browser acceptance checks.
- README, methodology, known limitations, data-source configuration, equity research sample, project
  report, three-minute demo script, and one-page summary PDF.
- Codex owns product acceptance, math review, test execution, final integration, GitHub, and delivery.
  Claude Opus 4.8 High is used as a coding/review partner where available; its output is never merged
  without independent Codex tests and review.
