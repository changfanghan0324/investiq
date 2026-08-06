# Data governance

Last reviewed: 2026-08-06

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

Fundamental observations follow one disclosed precedence ladder: (1) direct standard SEC fact,
(2) approved accounting-identity construction, (3) validated custom-extension fact when a
feature-flagged parser exists, (4) explicit user assumption, and (5) unavailable. The current release
does not implement a general custom-extension parser. Origin is stored per observation because one
series may legitimately mix direct and constructed fiscal years.

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
- Revenue may be constructed as gross profit plus cost of revenue only for a known non-financial
  issuer, exact annual start/end, USD unit, one accession, non-negative cost, and positive finite result.
- Direct revenue always wins. A parallel construction is retained only as a reconciliation diagnostic;
  mismatch tolerance is the greater of one dollar or one part per million of direct revenue.
- A combined D&A fact wins over separate depreciation plus amortization. Missing components never
  become zero, PP&E depreciation alone is never labeled combined D&A, and fewer than three aligned
  observations cannot be called a historical starter.
- Every constructed duration metric requires a single annual period and accession. Divergent-accession
  components fail closed instead of borrowing across filings.
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
