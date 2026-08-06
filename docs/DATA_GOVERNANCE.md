# Data governance

Last reviewed: 2026-08-04

## Evidence classes

| Class | Meaning | Public example |
| --- | --- | --- |
| Real SEC filing evidence | Official companyfacts/submissions facts with accession and period | Company financials |
| Reported anchor | Directly sourced model input | Revenue, cash, diluted weighted-average shares |
| Constructed anchor | Deterministic combination of aligned reported facts | Operating margin, FCF, net debt |
| Analyst assumption | User/author judgment, never presented as reported fact | Forecast growth, WACC, terminal growth |
| Licensed live market history | Provider data only when credentials, rights, and controls are ready | Disabled publicly today |
| Synthetic public-demo data | Deterministic workflow sample, not ticker history | Compare, Portfolio, DCA, Market Context |
| Unavailable | Missing, misaligned, unlicensed, or failed evidence | Shown as unavailable, never zero |

## Public deployment rule

Company financials use real SEC evidence. Market examples are all-or-nothing by run: capability is
resolved once and persisted across securities, benchmark loads, and retries. A licensed-live run does
not fall back per security. A synthetic run never calls the licensed provider. This prevents
correlation, beta, and portfolio figures from combining incompatible evidence modes.

Ticker labels on synthetic samples are navigation labels only. User-visible notices, CSV, PDF, and
assistant context must say that the series is synthetic and not actual market history.

## Missing data and lineage

- Missing facts never become zero.
- Balance-sheet components must share one date; duration facts must share one economic period.
- Constructed values retain receipts for every component.
- SEC facts retain form, accession, filing date, fiscal year/period, start/end dates, unit, and source
  URL as applicable.
- Amendments and duplicate filings are selected by documented deterministic rules.
- Market price is outside DCF mathematics and absent from the public featured case.

## Provider and licensing boundary

Production and remotely accessible preview market endpoints fail closed unless provider credentials,
public-display confirmation, and configured controls are present. Per-client rate limiting does not replace a durable shared
provider quota. Public live-market mode must not be enabled until both licensing and deployment-wide
quota ownership are approved. Vendor data rights are not granted by this repository.

## Readiness semantics

`/api/health` is a capability-readiness document, not a pure process-liveness probe. A complete
unavailable state intentionally returns HTTP 503 with a parseable no-store payload; the UI consumes
that payload and offers the synthetic demo. Split liveness/readiness endpoints should be introduced
only when an external monitor actually requires them.

## Privacy

Portfolio inputs, Risk Context answers, and downloads remain local to the browser except for the
minimum provider/API requests needed by an enabled workflow. No authentication or cloud save exists.
Public profile links render only after owner verification; null values are not shown.
