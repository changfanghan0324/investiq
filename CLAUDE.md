# CLAUDE.md — InvestIQ working agreement

InvestIQ is an educational US-market investment analytics platform. It explains risk and
return from end-of-day data. It never places trades and never gives investment advice.

Full product detail: [docs/INVESTIQ_PRODUCT_SPEC.md](docs/INVESTIQ_PRODUCT_SPEC.md).

## Routes

Five primary workspaces, declared in `src/config/navigation.ts`:

| Route | Workspace | State |
| --- | --- | --- |
| `/` | Market Overview | layout preview |
| `/stock` | Stock Analysis | layout preview |
| `/compare` | Stock Comparison | layout preview |
| `/portfolio` | Portfolio Lab | layout preview |
| `/dca` | DCA Backtest | fully functional |

`/methodology` is standalone documentation and stays out of the primary navigation.

Layout previews must stay honest: no invented prices, metrics, or calculated values. Every
placeholder region says it is not connected to market data yet.

## Localization and display

- English (`en`) and Simplified Chinese (`zh-CN`) only. Do not add other locales.
- Every user-visible string goes through `t()` in `src/i18n/language.tsx`. Both catalogs must
  stay complete; `zh-CN` is typed against the English catalog, so a missing key is a type error.
- Font scale options are `25`, `50`, `75`, `100`, with `25` as the default.

## Visual concepts

Reference designs live under `design/investiq/`:
`market-overview-concept.png`, `stock-analysis-concept.png`, `stock-comparison-concept.png`,
`portfolio-lab-concept.png`, `dca-backtest-concept.png`, `mobile-dca-concept.png`.

## Change-controlled files

These carry the calculation contract in `README.md`. No behavior change without accompanying
regression tests:

- `src/domain/backtest-engine.ts`, `src/domain/schedule.ts`, `src/domain/fees.ts`,
  `src/domain/portfolio-aggregate.ts`, `src/domain/projection-engine.ts`
- `src/services/create-portfolio-report.ts`, `src/services/create-report.ts`
- `src/server/market-data.ts`
- `src/constants/broker-presets.ts`, `src/data/demo-market-data.ts`

## Accessibility and mobile

- Keyboard reachable, visible focus, skip-to-content link, labelled landmarks and controls.
- Every icon-only or ambiguous control carries an `aria-label` from the catalog.
- Layout works from 320px up; mobile uses the compact bottom navigation.
- Respect `prefers-reduced-motion`; text stays legible at font scale `100`.

## Workflow

1. Codex owns product acceptance and review.
2. Claude Opus 5 implements the code.
3. Codex verifies the implementation.
4. The user approves all product decisions.

Run `npm run typecheck`, `npm run lint`, and `npm run test` (or `npm run check`) before
handing work back to Codex.
