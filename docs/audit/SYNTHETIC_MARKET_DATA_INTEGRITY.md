# Synthetic market-data integrity audit

Date: 2026-08-08

## Finding

The public demo intentionally uses deterministic synthetic price series when a licensed market-data
service is unavailable. Synthetic numbers must never be presented as current quotes, actual historical
prices, or investment performance.

## Covered routes and consumers

| Surface | Synthetic consumer contract |
| --- | --- |
| `/market` | Watchlist prices, return examples, risk metrics, and charts carry the persistent disclosure and provenance rail. |
| `/compare` | Synthetic run title, chart tabs, metric headers, exports, disclosure, and provenance are explicit. |
| `/portfolio` | Synthetic portfolio title, headline metrics, chart title/tab, exports, disclosure, and provenance are explicit. |
| `/tools/dca` | Demo history title, synthetic transaction-price header, chart/result disclosure, and provenance are explicit. |
| `/company/[ticker]` | The price-risk context uses the same disclosure and receipt; SEC fundamentals remain separately sourced. |

All derived return, volatility, Sharpe, drawdown, beta, attribution, and DCA calculations remain
deterministic educational calculations over the supplied series. The calculation formulas were not
changed by this remediation.

## Provenance contract

Every `MarketData.provenance` value contains:

```ts
interface DataProvenance {
  sourceType: "synthetic" | "licensed-live";
  provider: string;
  generatedAt: string;
  disclaimer: string;
}
```

The existing coverage fields remain on the same object. The demo generator sets `sourceType` to
`synthetic`, identifies itself as the provider, stamps an ISO generation time, and carries the exact
public-demo disclaimer. Live values are only classified as `licensed-live` when the configured
provider path supplies them; this task did not add or enable a provider.

## UI guardrails

Synthetic surfaces render:

> Public Demo Market Data
>
> This page uses synthetic market series for demonstration. It does not represent actual historical
> prices or investment performance.

The UI uses **Synthetic Price Series**, **Illustrative Market Data**, **Demo Market History**, and
**Synthetic Return Example**. It avoids **Current Price**, **Live Price**, **Historical Return**, and
**Historical Performance** for synthetic values.

## Verification

- Unit contract verifies every generated demo dataset is synthetic and carries provider, timestamp,
  and disclosure fields.
- Browser contracts assert the disclosure and provenance rail on `/market`, synthetic comparison and
  portfolio runs, and DCA demo results; they also reject current-price and historical-performance
  labels in those runs.
- Typecheck, lint, unit tests, production build, and Playwright checks are required before merge.

## Remaining limitation

No licensed market provider is connected in the public demo. Consequently, all market prices and
derived market analytics on these routes remain illustrative synthetic examples, while SEC filing
facts retain their separate filing provenance.
