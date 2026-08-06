# InvestIQ after review

Reviewed on 2026-08-05 in the real in-app browser against the local build on
`codex/quiet-institutional-redesign`. Desktop captures use 1440 x 1000 and
mobile captures use 390 x 844. The screenshot set mirrors the baseline and adds
a DCA result-state capture.

## Outcome

The first-use experience is now a light, editorial research workspace. The home
page begins with a ticker search; Compare, Portfolio, and DCA begin with a basic
form; long financial and methodological controls remain available in native,
keyboard-operable `details` disclosures.

## First-view evidence

| Route | First visible heading | Primary actions | Basic controls | Advanced initially hidden | Content cards | Decorative icons | First task needs scroll |
| --- | --- | ---: | ---: | --- | ---: | ---: | --- |
| `/` | Company research built from SEC filings. | 1 | 1 ticker input | N/A | 0 | 0 | No |
| `/company/AAPL` | Apple Inc. or an explicit unavailable state | 0 | 0 | Filing detail wall | 0 | 0 | No |
| `/company/AAPL/financials` | Financial statement analysis or explicit unavailable state | 0 | 0 | Receipts and detailed tables | 0 | 0 | No |
| `/company/AAPL/valuation` | Valuation workspace or explicit unavailable state | 1 | Core DCF assumptions | Supporting detail | 1 | 0 | No |
| `/compare` | Stock Comparison | 1 | 2 symbols + period | Risk-free rate, method notes, custom dates | 1 | 0 | No |
| `/portfolio` | Build a portfolio | 1 | 2 symbols, 2 weights, period, capital | Risk-free rate and alternative weights | 1 | 0 | No |
| `/tools` | Research tools | 0 | 0 | N/A | 0 | 0 | No |
| `/tools/dca` | Test a recurring investment plan | 1 | Ticker, amount, frequency, 2 dates | Order, fee, tax, broker assumptions | 2 | 0 | No on desktop; CTA follows the form on mobile |
| `/case-study/aapl` | AAPL research case study | 0 | 0 | Research detail follows summary | 0 | 0 | No |
| `/about` | About InvestIQ | 0 | 0 | N/A | 0 | 0 | No |

Counts exclude global navigation. A “card” means a visually enclosed product
surface, not a table row, definition list, or thin-rule editorial section.

## System changes

- Typography: removed IBM Plex Next Font loading. Ordinary UI uses the system
  sans stack; mono is reserved for technical identifiers. Numbers use tabular
  lining figures.
- Color: light-first cool neutrals, graphite text, one muted navy accent, and
  restrained semantic green, red, and ochre.
- Surfaces: page hierarchy is created with whitespace and 1 px rules. Borders
  and subtle shadows are limited to working forms and primary results.
- Motion: rendered home and DCA result states contained zero infinite
  animations. Loading indicators remain available only while work is active.
- Effects: rendered home and DCA result states contained zero gradients and zero
  backdrop filters.
- Icons: the home content contains no decorative icons. DCA no longer renders
  Sparkles, ambient art, or an AI feature icon. The compact mobile navigation
  retains four functional outline icons.
- Mobile: the bottom navigation is four equal columns; all five audited 390 px
  routes reported zero page-wide horizontal overflow.

## Accessibility evidence

- Full Playwright suite: 26 passed, 14 intentionally skipped by project
  conditions, 0 failed (single worker used to avoid a local Next dev-manifest
  race on the iCloud-synced filesystem).
- Axe critical/serious checks passed for the home, AAPL case, and DCA result
  contracts on the applicable desktop/mobile projects.
- Keyboard, focus, native disclosure, language, print, 320 px, and 145% text
  contracts passed.
- Browser QA at 390 px reported zero horizontal overflow for home, company,
  Compare, Portfolio, and DCA.
- Home and DCA result browser logs contained no warnings or errors.

## Data-state note

The local browser environment intentionally had no SEC contact configuration.
Company screenshots therefore show the product's explicit unavailable state;
they do not substitute zeros or synthetic fundamentals. The AAPL case-study
capture provides the complete editorial research layout. Deployment validation
must confirm the preview environment inherits the production SEC configuration.

## Screenshot register

- Matching desktop and mobile captures: `docs/design-audit/after/`
- Additional completed DCA result: `docs/design-audit/after/dca-result-mobile.png`
- Image-generation direction studies: `docs/design-audit/concepts/`
