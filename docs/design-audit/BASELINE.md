# InvestIQ visual and usability baseline

Captured on 2026-08-05 from the public production deployment at commit
`9c55c0ceb6bc816a87753138f3ee4e174a0090c1` (Vercel deployment
`dpl_2N3aoXgPaZJJ8Nxhja24k8cVqacL`). Screenshots use the real rendered product,
not source-code inference.

## Measurement notes

- Desktop viewport: 1440 x 1000.
- Mobile viewport: 390 x 844.
- CTA counts exclude global header, navigation, and footer links.
- Form-control counts include visible inputs, selects, and textareas in the first
  viewport.
- Card counts are a conservative rendered estimate; repeated bordered metric and
  setup surfaces are counted as cards even when their CSS class is named panel or
  section.
- Icon counts include visible SVG icons in the first viewport.
- “First step clear” is a product-review judgment based on the rendered heading,
  first action, and whether the primary task can begin without scrolling.

## Desktop baseline

| Route | First visible heading | First visible action | CTAs | Controls | Cards | Icons | Glow / gradient / loop | Heavy mono | Scroll to begin | First step clear |
| --- | --- | --- | ---: | ---: | ---: | ---: | --- | --- | --- | --- |
| `/` | Investment research you can audit. | Explore the AAPL case study | 2 | 0 | 2 | 14 | No / no / no | Yes | Yes | No |
| `/company/AAPL` | Reading official company filings, then Apple Inc. | Summary tab | 0 | 0 | 4 | 4 | No / no / loading | Yes | No | Partial |
| `/company/AAPL/financials` | Financial statement analysis | Summary tab | 0 | 0 | 4 | 4 | No / no / no | Yes | No | Partial |
| `/company/AAPL/valuation` | DCF valuation workspace | Summary tab | 1 | 11 | 2 | 7 | No / no / no | Yes | No | No |
| `/compare` | Stock Comparison | Ticker 1 input | 4 | 5 | 2 | 5 | No / no / no | Yes | No | Partial |
| `/portfolio` | Portfolio Lab | Holding 1 ticker input | 8 | 10 | 3 | 9 | No / no / no | Yes | No | No |
| `/tools` | Research tools | Historical DCA backtest | 2 | 0 | 2 | 5 | No / no / no | Yes | No | Yes |
| `/tools/dca` | Portfolio performance | Collapse backtest setup | 28 | 14 | 9+ | 16 | Yes / yes / 3 | Yes | No | No |
| `/case-study/aapl` | AAPL research case study | Open live AAPL research | 0 | 0 | 3 | 5 | No / no / no | Yes | No | Partial |
| `/about` | About InvestIQ | View the AAPL case study | 0 | 0 | 3 | 3 | No / no / no | Yes | No | Yes |

## Mobile baseline

| Route | First visible heading | First visible action | CTAs | Controls | Cards | Icons | Glow / gradient / loop | Heavy mono | Overflow | First step clear |
| --- | --- | --- | ---: | ---: | ---: | ---: | --- | --- | --- | --- |
| `/` | Investment research you can audit. | Explore the AAPL case study | 2 | 0 | 2 | 9 | No / no / no | Yes | No | No |
| `/company/AAPL` | Apple Inc. | Summary tab | 0 | 0 | 4 | 6 | No / no / no | Yes | No | Partial |
| `/compare` | Stock Comparison | Ticker 1 input | 3 | 5 | 2 | 3 | No / no / no | Yes | **Yes** | Partial |
| `/portfolio` | Portfolio Lab | Holding 1 ticker input | 3 | 6 | 3 | 3 | No / no / no | Yes | No | No |
| `/tools/dca` | No visible page H1 | Collapse backtest setup | 14 | 13 | 4+ | 10 | Yes / yes / 3 | Yes | No | No |

## Primary findings

1. The home page delays the primary task. The first viewport contains product
   philosophy, two competing CTAs, and a five-step evidence diagram, but no ticker
   input.
2. The dark palette, bright blue accents, outlined icon rails, monospaced body
   copy, and large bordered surfaces create an AI/crypto-dashboard impression.
3. Portfolio exposes holdings, optimization methods, dates, risk-free-rate copy,
   loading state, and methodology at once. The primary task is technically
   possible but not visually prioritized.
4. DCA is the strongest usability risk. It defaults to three holdings, presents a
   permanent three-column terminal, shows generated results immediately, and puts
   service status, AI, help, and export actions in the global header.
5. Compare has a mobile horizontal-overflow regression at 390 px.
6. Company and case-study pages preserve evidence well but use dashboard framing,
   excessive mono, and dense control clusters instead of an editorial research
   hierarchy.

## Screenshot register

Desktop screenshots are in `docs/design-audit/before/*-desktop.png`; mobile
screenshots are in `docs/design-audit/before/*-mobile.png`. The set covers every
route and viewport required by the redesign brief.
