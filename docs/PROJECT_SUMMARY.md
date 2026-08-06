# InvestIQ - Project Summary

## Product

InvestIQ is an evidence-first investment research and portfolio analytics platform for aspiring
equity-research analysts, finance students, asset-management interns, and self-directed investors.
It connects official filing facts, scenario valuation, portfolio risk, and an evidence-linked
investment memo without presenting educational analysis as investment advice.

## Core workflow

1. Research a US company using latest-reported annual SEC facts and source receipts.
2. Inspect five-year trends, constructed margins, cash flow, and explicit unavailable metrics.
3. Run an editable FCFF DCF, bear/base/bull scenarios, two sensitivity matrices, and user-sourced
   comparable-company multiples.
4. Analyze a 1-10 holding portfolio using return, volatility, Sharpe, Sortino, beta, alpha,
   historical VaR, drawdown, correlation, attribution, and concentration.
5. Turn the evidence and analyst-owned interpretation into a printable memo or full report.
6. Use Market Context or 1-10 holding Historical DCA as supporting workflows.

## Technical contribution

- Next.js, TypeScript, React, CSS Modules, Recharts, Vitest, and Vercel-ready server routes.
- Restatement-aware SEC companyfacts selection based on economic reporting periods.
- Pure, independently testable valuation and risk engines with documented calculation contracts.
- English and Simplified Chinese interface, four text scales, responsive layouts, and accessible
  controls.
- Sequential provider loading, same-origin APIs, bounded requests, neutral errors, and server-only
  credentials.

## Quality and model governance

- Ranges and sensitivities appear before a point estimate.
- Unsupported results remain unavailable rather than being silently treated as zero.
- Latest-reported filing facts are not inserted backward into historical performance analysis.
- DCF starter assumptions remain editable and visibly separate from reported facts.
- Historical VaR is not described as a maximum loss, and inverse-volatility allocation is not
  described as an optimizer.
- Future DCA estimates are disabled. Public market examples are synthetic workflow demonstrations,
  not actual ticker history; company financials remain real SEC evidence.

## Evidence base

Methodology follows SEC EDGAR API guidance, CFA Institute material on downside risk and VaR, and
Damodaran's firm-valuation and terminal-value framework. Full assumptions, sources, limitations,
tests, and known gaps are documented in README.md, docs/METHODOLOGY.md,
docs/DATA_GOVERNANCE.md, docs/FINANCIAL_MODEL_CONTRACTS.md, and /methodology.

## Portfolio deliverables

Public web application, source repository, completed AAPL case, methodology, project report,
usability protocol (no participant results claimed), release-candidate package, and demo script.

`output/pdf/InvestIQ_Project_Summary.pdf` is a generated convenience artifact. Its Markdown/source
dependencies and content drift must be checked before release; the repository does not claim that a
tracked binary automatically stays synchronized.

Educational research software only. Not investment, legal, or tax advice.
