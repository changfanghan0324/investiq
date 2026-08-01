# InvestIQ — three-minute demo script

## 0:00–0:25 — Positioning

“InvestIQ is an investment research and portfolio analytics platform for finance students and early
career analysts. It does not recommend securities. It connects official company facts, transparent
valuation assumptions, portfolio risk, and an evidence-linked memo.”

Show the Research home. Point out the ticker-first entry, recent research, English/Simplified Chinese
selector, and text-size control.

## 0:25–0:55 — Company Summary

Open AAPL. Explain that Company Summary deliberately shows only five first-level outputs. Open the SEC
receipt and note that annual facts are latest-reported/restatement-aware. Mention that missing ratios
stay unavailable instead of becoming zero.

## 0:55–1:30 — Financials and Valuation

Open Financials. Point to revenue CAGR, margin percentage-point change, FCF, capability gates, and an
accession row.

Open Valuation. Review SEC-derived anchors and editable assumptions. Run the model. Show the
bear/base/bull range before the base estimate, then WACC×terminal-growth and growth×margin
sensitivities. Explain that current price is dated and separate. Open the comparable method: users
must supply sourced peer multiples; the platform does not invent an industry median.

## 1:30–2:15 — Portfolio Lab

Build AAPL/MSFT/SPY with user weights. Explain the exact common trading calendar and one return basis.
Show return, volatility, Sharpe, Sortino, historical VaR, beta, alpha, drawdown, attribution,
correlation, and concentration. Apply inverse-volatility weights and clarify that it is a transparent
historical rule, not an optimizer or recommendation.

## 2:15–2:45 — Investment Memo

Return to AAPL and open Investment Memo. Show the saved DCF range, financial evidence, source receipt,
and separate thesis/catalyst/risk fields. Save notes, open Full report / PDF, and show the five-year
evidence table, ratio diagnostics, DCF assumptions, filing register, and bilingual PDF export. Emphasize that facts,
assumptions, and interpretation are visibly distinct.

## 2:45–3:00 — Engineering close

“The application is Next.js and strict TypeScript, with server-only data adapters, deterministic
financial engines, regression tests, bilingual responsive UI, bounded public routes, and explicit
methodology. The key product decision is to withhold unsupported outputs—including future DCA
projections—rather than publish false precision.”
