# Visual subtraction changelog

| Before | Problem | Change | Reason | Evidence |
| --- | --- | --- | --- | --- |
| Dark dashboard shell with dense utility controls | Read as a crypto/AI terminal and made every page feel operationally busy | White 58 px shell, muted active rule, plain EN/text-size selectors, four-item mobile nav | Establish one calm institutional frame | `before/home-desktop.png` vs `after/home-desktop.png` |
| IBM Plex Sans and Mono loaded globally | Developer-oriented tone and excessive mono treatment | Removed Next Font imports; installed system sans/mono token stacks; renamed Geist-era variables | More natural reading across English and Simplified Chinese | `src/app/layout.tsx`, `src/app/globals.css` |
| Philosophy-first home with icon workflow and two CTAs | Ticker task was below the fold and the first action was ambiguous | Four editorial sections with an above-fold ticker search and one primary CTA | A first-time user can begin within seconds | `before/home-mobile.png` vs `after/home-mobile.png` |
| Data truth distributed across preview cards | Real/synthetic distinction competed with product marketing | Compact definition-list disclosure directly below search | Make provenance scannable without adding a card | `after/home-desktop.png` |
| Company summary opened with a metric wall | Evidence was strong but the reading order was unclear | Company/filing basis, four core metrics, reported change, then links; long detail moved into `details` | Preserve receipts while prioritizing the research conclusion | `src/components/company-summary.tsx` |
| Compare auto-ran and exposed all assumptions | Example state looked complete before user intent and advanced inputs competed with symbols | No initial run; 1Y/3Y/5Y/Custom; custom dates conditional; risk-free/method notes collapsed | Basic comparison is understandable without losing assumptions | `after/compare-mobile.png` |
| Portfolio exposed ten controls, optimization options, and results immediately | High cognitive load and no clear first action | Two 50/50 holdings, no auto-run, period/capital basic, risk-free and alternative weights disclosed later, four headline results | One coherent portfolio-building task | `before/portfolio-desktop.png` vs `after/portfolio-desktop.png` |
| DCA rendered three holdings, a permanent terminal, market pulse, ambient art, AI action, and many metrics | Strongest source of AI/crypto visual language and first-use confusion | One holding, one mode-aware run action, collapsed order/fee/tax assumptions, result-only explanation/export, four metrics and one chart | Make the model operable by a non-specialist and keep evidence visible | `before/dca-desktop.png`, `after/dca-desktop.png`, `after/dca-result-mobile.png` |
| Tools used two icon cards | Decorative treatment was larger than the two available tasks | Two text rows with concise descriptions and links | Navigation should not resemble a feature marketplace | `after/tools-desktop.png` |
| Case Study, About, memo, and report pages used dashboard framing | Research documents looked inconsistent with the simplified product | Editorial light surfaces, restrained rules, system type, and consistent evidence hierarchy | Align product pages with institutional research deliverables | `after/case-study-aapl-desktop.png`, `after/about-desktop.png` |
| Mobile Compare overflowed at 390 px and bottom nav inherited a five-column definition | Failed a required responsive contract | Responsive one-column controls and explicit four equal nav columns | Natural phone operation and stable labels | Baseline finding; Playwright 320 px and browser 390 px now report zero overflow |
| Decorative gradients, blur, glow, and looped motion were visible | Reduced trust and distracted from financial evidence | Global computed-effect removal plus non-rendering of ambient/pulse components | Visual calm without touching domain behavior | Browser computed-style audit: 0 gradients, 0 backdrop filters, 0 infinite animations on home and DCA result |

## Preserved scope

No domain calculation, API contract, database schema, SEC selection rule, data
licensing gate, missing-value rule, DCF guardrail, Portfolio analytics formula, or
DCA fee/tax formula was changed.
