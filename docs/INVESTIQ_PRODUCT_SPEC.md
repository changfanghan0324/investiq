# InvestIQ product specification

## Purpose

InvestIQ is an educational investment analytics platform for US-listed stocks and ETFs. It
turns end-of-day market data into readable risk and return analysis — performance, volatility,
drawdown, correlation, concentration, and recurring-investment backtests — and explains how
every number is produced. It is research software: no order routing, no investment or tax
advice, no guarantee that market data or broker fee schedules are complete or current.

## Workspaces

Five primary workspaces plus standalone documentation.

| Route | Workspace | Scope |
| --- | --- | --- |
| `/` | Market Overview | Index benchmarks and a personal watchlist: return, volatility, drawdown |
| `/stock` | Stock Analysis | One symbol: price history, rolling volatility, risk metrics, corporate actions |
| `/compare` | Stock Comparison | 2–5 symbols on one aligned calendar: total return, risk table, correlation |
| `/portfolio` | Portfolio Lab | Buy-and-hold weights totalling 100%: performance, concentration, attribution |
| `/dca` | DCA Backtest | Recurring contributions with dividends, fees, taxes, drawdown, PDF report |
| `/methodology` | How it works | Documentation of the calculation rules; not part of primary navigation |

`/methodology` is deliberately outside `primaryRoutes` in `src/config/navigation.ts`.

## Foundation migration status

Only **DCA Backtest** is fully functional. The other four routes are honest layout previews:
they present structure, labels, and intent, and every data region states that it is not yet
connected to market data. Previews must never display invented, illustrative, or placeholder
numeric values.

## Localization

- English and Simplified Chinese only. No Spanish, no Japanese, no other locales.
- All copy comes from the catalogs in `src/i18n/language.tsx`. The `zh-CN` catalog is typed
  against the English catalog, so both stay in sync by construction.

## Font scale

Four levels — `25`, `50`, `75`, `100` — with `25` as the default. The selection is persisted per
browser and applied as a root multiplier; all layouts must remain usable at `100`.

## Visual concepts

`design/investiq/market-overview-concept.png`, `design/investiq/stock-analysis-concept.png`,
`design/investiq/stock-comparison-concept.png`, `design/investiq/portfolio-lab-concept.png`,
`design/investiq/dca-backtest-concept.png`, `design/investiq/mobile-dca-concept.png`.

## Calculation and data files under change control

The `## Calculation contract` section of `README.md` is a product contract. The files that
implement it cannot change behavior without regression tests:

- Engines: `src/domain/backtest-engine.ts`, `src/domain/schedule.ts`, `src/domain/fees.ts`,
  `src/domain/portfolio-aggregate.ts`, `src/domain/projection-engine.ts`
- Report assembly: `src/services/create-portfolio-report.ts`, `src/services/create-report.ts`
- Market data: `src/server/market-data.ts`
- Fixed data: `src/constants/broker-presets.ts`, `src/data/demo-market-data.ts`

Existing suites: `src/domain/backtest-engine.test.ts`, `src/domain/fees.test.ts`,
`src/services/create-portfolio-report.test.ts`, `src/server/market-data.test.ts`.

## Accessibility requirements

- Full keyboard operation with visible focus and a skip-to-content link.
- Landmarks and navigation regions labelled; every control has an accessible name from the
  translation catalog, including icon-only controls.
- Charts and data regions expose text equivalents or explicit empty-state descriptions.
- Colour is never the only signal; motion respects `prefers-reduced-motion`.

## Mobile requirements

- Usable from 320px width upward, single-column with no horizontal scrolling.
- Compact bottom navigation for the five primary routes on small screens.
- Touch targets at least 44px; wide tables scroll within their own container.

## Workflow and ownership

1. **Codex** owns product acceptance and review, and defines the scope of each change.
2. **Claude Opus 5** implements the code within that scope.
3. **Codex** verifies the result against this specification.
4. **The user** approves all product decisions.
