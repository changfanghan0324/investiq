# Known limitations

Last reviewed: 2026-08-04

- **Public live-market licensing:** public live history is disabled pending display-rights approval
  and durable deployment-wide provider quota controls.
- **Synthetic market examples:** public price, comparison, portfolio, market-context, and DCA samples
  are synthetic and do not describe actual ticker history. The generator demonstrates calculation
  paths and is not calibrated to reproduce plausible security-level risk/return distributions.
- **SEC availability:** EDGAR availability, taxonomy, amendments, and issuer reporting quality can
  make evidence unavailable; facts are not guessed.
- **No investment advice:** outputs are research/education and are not recommendations, forecasts,
  price targets, or guarantees.
- **No sector source where unavailable:** sector exposure is not inferred without an authoritative
  source.
- **No suitability assessment:** Risk Context is educational and does not determine investor
  suitability, capacity, objectives, or fiduciary advice.
- **No future DCA:** the DCA workflow ends at the last completed session and does not project future
  prices, dividends, or returns.
- **No authenticated cloud save:** there is no login, synchronized portfolio, or durable user account.
- The downloadable DCA PDF body is English-only in this release; the web UI is bilingual.
- Adjusted close is a vendor total-return proxy, not independently audited dividend accounting.
- DCA fee/tax models are explicit simplifications and do not implement every jurisdiction, lot rule,
  wash sale, NIIT, return of capital, or account type.
- `/api/health` reports capability readiness and intentionally may return 503 while the web app and
  synthetic demo remain available.
- No open-source license has been selected; third-party/vendor rights are never included.
