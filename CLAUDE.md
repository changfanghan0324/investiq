# CLAUDE.md — InvestIQ working agreement

InvestIQ is an educational, evidence-first investment research and portfolio analytics
platform for US-listed equities. It connects official filings, transparent valuation
assumptions, and end-of-day price/risk analytics. It never places trades or gives advice.

Full product detail: [docs/INVESTIQ_PRODUCT_SPEC.md](docs/INVESTIQ_PRODUCT_SPEC.md).

## Routes

Four primary workspaces, declared in `src/config/navigation.ts`:

| Route | Workspace | State |
| --- | --- | --- |
| `/` | Research launcher | functional |
| `/compare` | Stock Comparison | functional price/risk analysis |
| `/portfolio` | Portfolio Analytics | functional price/risk analysis |
| `/tools` | Historical DCA and Market Context | functional hub |

Company research uses nested routes: `/company/[ticker]`, `/financials`, `/valuation`,
and `/memo`. Historical DCA lives at `/tools/dca`; `/dca` remains a compatibility redirect.
Market context lives at `/market`. `/methodology` stays out of primary navigation.

No invented prices, metrics, classifications, or calculated values. Every unavailable
field stays unavailable and every research figure carries a source/date or formula receipt.

## Localization and display

- English (`en`) and Simplified Chinese (`zh-CN`) only. Do not add other locales.
- Every user-visible string goes through `t()` in `src/i18n/language.tsx`. Both catalogs must
  stay complete; `zh-CN` is typed against the English catalog, so a missing key is a type error.
- User-facing text scales are 100%, 115%, 130%, and 145% (stored as `25`, `50`, `75`, `100`),
  with 100% / `25` as the default.

## Visual concepts

Reference designs live under `design/investiq/`:
Legacy concepts remain under `design/investiq/`. The accepted redesign references are the
Research launcher and Company Summary concepts created in the active Codex task.

## Change-controlled files

These carry calculation contracts documented in `docs/METHODOLOGY.md`,
`docs/FINANCIAL_MODEL_CONTRACTS.md`, `docs/DATA_GOVERNANCE.md`, and
`docs/SEC_SELECTION_RULES.md`. No behavior change without accompanying regression tests:

- `src/domain/backtest-engine.ts`, `src/domain/schedule.ts`, `src/domain/fees.ts`,
  `src/domain/portfolio-aggregate.ts`, `src/domain/projection-engine.ts`
- `src/services/create-portfolio-report.ts`, `src/services/create-report.ts`, `src/services/create-equity-report.ts`
- `src/server/market-data.ts`
- `src/constants/broker-presets.ts`, `src/data/demo-market-data.ts`

## Accessibility and mobile

- Keyboard reachable, visible focus, skip-to-content link, labelled landmarks and controls.
- Every icon-only or ambiguous control carries an `aria-label` from the catalog.
- Layout works from 320px up; mobile uses the compact bottom navigation.
- Respect `prefers-reduced-motion`; text stays legible at 145% / stored font scale `100`.

## Workflow

1. Codex owns product acceptance and review.
2. Claude uses the highest officially available Opus model with high effort for its assigned
   data/domain work; never label an unavailable model as Opus 5.
3. Codex owns IA/UI integration. Both sides cross-review; an engine author cannot solely
   approve their own calculation code.
4. Product decisions follow the agreed progressive-disclosure and evidence-first contract.

Run `npm run typecheck`, `npm run lint`, and `npm run test` (or `npm run check`) before
handing work back to Codex.
