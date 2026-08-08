# SEC data validation

**Review date:** 2026-08-08
**Contract:** annual, as-most-recently-reported fundamentals with receipt-level provenance

## What is being validated

InvestIQ selects facts from SEC company facts and submissions data only when the fact has a valid
ticker/CIK identity, an acceptable annual form and duration, a safe unit, and an economic period that
can be aligned with the other inputs. Every reported observation retains accession, filing date,
period, concept, and an official filing-index URL. A missing field is represented as unavailable;
it is never replaced with zero.

## Coverage matrix

| Scenario | Expected behavior | Regression evidence |
| --- | --- | --- |
| AAPL direct revenue | Select the highest-precedence direct standard revenue fact, retain one receipt, and keep the identity as non-financial | `fundamentals.test.ts` — “keeps AAPL direct revenue…”; SEC happy-path identity/receipt test |
| FSLY direct revenue | Select Fastly's standard direct revenue across FY2021–FY2025 and reconcile the accounting identity | `fundamentals.test.ts` — “selects Fastly direct standard revenue and reconciles…” |
| FSLY missing direct revenue | Construct revenue only from aligned `grossProfit + costOfRevenue`, retain both receipts, and fail closed on mismatched accessions | `fundamentals.test.ts` — “constructs revenue only…” and “fails closed…” |
| Loss-making issuer | Preserve a negative operating result/margin as a negative observation; never clamp it to zero or label it profitable | FSLY fixture and the same direct/constructed revenue tests; calculation domains preserve signed values |
| Financial issuer | Flag SIC 6000–6999 and classify model-excluded measures as not applicable, while keeping genuinely unreported measures separate | `fundamentals.test.ts` — financial-issuer capability; `company-coverage.test.ts` — classification split |
| Missing standard data | Return unavailable metric series with a reason and no invented value | `fundamentals.test.ts` — “reports every metric unavailable…” |
| Invalid ticker | Reject malformed/overlong symbols with a neutral 400 before provider work | `sec.test.ts` — `validateFundamentalsTicker` |
| Unknown ticker/empty facts | Return neutral 404; do not fabricate an empty company | `sec.test.ts` — absent directory and no-facts cases |
| SEC contact missing | Return neutral 503 before any upstream request | `sec.test.ts` — SEC contact configuration |
| SEC 403/5xx/malformed JSON | Map upstream failures to neutral 502/503 responses and never leak the provider body | `sec.test.ts` — upstream failure cases |

## Numerical anchor examples from fixtures

The FSLY fixture intentionally contains a loss-making operating value of `-119,000,000` against
revenue of `624,018,000`; the expected constructed margin is the signed ratio
`-119,000,000 / 624,018,000`. The fixture revenues are `624,018,000`, `543,676,000`, `505,988,000`,
`432,725,000`, and `354,330,000` for FY2025 through FY2021. These are test fixtures, not a claim
about a current quote or a substitute for the live filing response.

## Integrity rules preserved in v1.0.0 preparation

- No finance calculation file under the AGENTS.md change-control list was modified.
- Direct standard facts take precedence over constructed fallbacks.
- Annual periods must be economically aligned; filing `fy` metadata cannot override the period end.
- Restatements select the latest filed value for the same economic period, with amended-form tie rules.
- Wrong units, partial-year durations, mismatched component dates, and cross-accession constructions
  remain unavailable rather than being silently coerced.
- The public release keeps the production SEC contact requirement and licensing/rate-limit gates.
