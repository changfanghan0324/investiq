# InvestIQ — three-minute public-demo script

## 0:00–0:25 — Positioning and data truth

“InvestIQ connects official SEC evidence, explicit valuation assumptions, and portfolio risk in a
reproducible research workflow. It does not recommend securities.”

Show the homepage notice and say: “Company financials use real SEC filings. Price, comparison,
portfolio, and DCA examples use synthetic data—not actual ticker history.” Show the owner, case link,
language selector, and text-size control.

## 0:25–1:15 — Completed AAPL case

Open `/case-study/aapl`. Show the FY2025 snapshot date, 10-K accession, six evidence metrics, and
direct/constructed labels. Point to one computed analyst observation and its source receipts. Show
reported anchors, constructed anchors, and analyst assumptions as different categories.

Show the bear/base/bull values and 5×5 sensitivity. Explain: “These are values under stated
assumptions, not a forecast, recommendation, or market-price comparison.” Show official-source
catalysts, risks, final uncertainty framework, and source register.

## 1:15–1:55 — Company research output

Open current AAPL research, Financials, and Valuation. Show real SEC receipts and that missing inputs
remain unavailable rather than zero. Change WACC and run the existing DCF. Open Memo or Report and
show that reported facts, model assumptions, and analyst interpretation remain separate.

## 1:55–2:30 — Synthetic portfolio workflow

Open Portfolio Lab. Before discussing any metric, point to `Synthetic public-demo data` and say:
“AAPL, MSFT, and SPY are labels on synthetic samples here; these figures are not their historical
performance.” Build fictional weights totaling 100%. Show common-calendar alignment, return basis,
drawdown, risk measures, attribution, correlation, and concentration. Do not call the result live or real.

## 2:30–2:50 — DCA and export provenance

Open Historical DCA, show `Public demo available / Live market history not enabled`, run the demo,
and point to the in-body synthetic notice and `Synthetic series` tab. Export the PDF and show its
synthetic filename, top warning, not-a-forecast statement, and page footer.

## 2:50–3:00 — Engineering close

“Pure TypeScript domains and tests control the calculations. Data lineage fails closed, a run cannot
mix licensed and synthetic series, AI explanations cannot alter the math, and unsupported outputs are
withheld. The repository includes a prepared usability protocol; participant results are not claimed.”
