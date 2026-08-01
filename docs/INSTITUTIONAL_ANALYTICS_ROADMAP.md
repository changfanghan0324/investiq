# InvestIQ Institutional Analytics Roadmap

**Decision date:** 2026-08-01
**Scope:** US-listed companies and ETFs; educational research software; no trade execution or
personalized investment advice.

This document is the implementation contract for moving InvestIQ from a portfolio demo to an
auditable investment-research platform. It records what can be built with public information, what
requires a commercial data license, which costs trigger an architecture change, and which controls
must exist before an output can be described as professional-grade.

The plan was independently challenged through Claude Code using the latest Opus model available to
the signed-in account (`claude-opus-4-8`, high effort). No Claude API key was used. The review agreed
with the evidence-first direction but required two changes:

1. Authentication becomes a prerequisite as soon as the product promises saved user portfolios.
2. Licensed end-of-day adjusted data should be evaluated before paying for real-time exchange data.

## 1. What “public display” means

API access and public-display rights are separate products. A personal API subscription can permit
analysis by one subscriber while prohibiting the same values from appearing in a public website.
For InvestIQ, public display includes:

- OHLCV history, adjusted close, delayed or real-time quotes in charts, tables, exports, or PDFs;
- dividends, splits, corporate actions, company reference data, and security metadata;
- financial statements, normalized ratios, estimates, classifications, and peer constituents;
- cached data returned to another user; and
- derived analytics when the vendor contract defines them as redistributable or display data.

Before enabling a provider in Production, InvestIQ requires a written order form or terms that cover
the intended audience, data fields, delay, geography, caching, PDF/CSV export, and derived analytics.
“The API works” is never licensing evidence.

### Public price and licensing screen

Prices below are USD and were checked against official provider pages on 2026-08-01. Exchange fees,
approvals, taxes, and negotiated order-form terms may be additional.

| Provider | Public entry point | Public-display conclusion |
| --- | ---: | --- |
| [Intrinio Startup](https://intrinio.com/pricing) | $333/month for months 1–6, $666 for months 7–12, $999 thereafter | Explicitly advertises Display & Commercial Use and a business-wide license, but the executed order form remains controlling. The $150 Individual plan explicitly forbids redistribution or external display. |
| [Massive Stocks Business](https://massive.com/business) | $1,999/month | Base Business bundle with business use and real-time fair-market value; financials and ratios are included. Full-market delayed ($499/month) and full-market real-time ($1,999/month) are separately priced exchange-feed expansions. Confirm the final display, expansion, and exchange scope in contract. |
| [Massive Financials & Ratios](https://massive.com/business) | $699/month | Business use for fundamentals without the stock-data bundle. |
| [EODHD Commercial](https://eodhd.com/commercial-pricing) | Internal use $399/month; enterprise $2,499/month; custom from $399/month | Internal use explicitly cannot be shown externally. Public-user display requires the appropriate enterprise/custom agreement; obtain a written quote before selection. |
| [Alpha Vantage Commercial](https://www.alphavantage.co/realtime_data_policy/) | Quote required | Personal premium does not grant commercial real-time or 15-minute-delayed display. Commercial onboarding is required. |

**Decision:** do not buy a feed now. Keep live market data gated while requesting an EOD-only,
split-adjusted US-equities display quote. Intrinio is the clearest self-service licensing reference:
its introductory price is $333/month for six months, but the steady-state Startup price is
$999/month after month 12. EODHD and Alpha Vantage are quote comparisons. Real-time data is outside
the MVP because it adds cost without improving five-year financial analysis, DCF, or portfolio-risk
methodology.

## 2. What “investment-bank-grade” means here

InvestIQ will not claim to replace Bloomberg, FactSet, S&P Capital IQ, or LSEG Workspace. Those
terminals combine licensed datasets, analyst estimates, news, documents, identifiers, corporate
actions, messaging, compliance controls, and support teams. The achievable and defensible target is
an **analyst-grade research workflow** with terminal-style auditability.

| Maturity | Required capability | InvestIQ decision |
| --- | --- | --- |
| Research foundation | SEC facts and filings, deterministic ratios, DCF scenarios, portfolio risk, citations, tests | Build now |
| Analyst workflow | saved assumptions, immutable snapshots, peer review/override, source receipts, memo claim citations | Next product phase |
| Professional data | licensed EOD prices, normalized point-in-time fundamentals, corporate actions, identifiers, estimates/transcripts | Contract and budget required |
| Institutional terminal | multi-asset data, real-time feeds, entitlements, research library, support/SLA, compliance integration | Explicitly out of scope |

Professional quality is measured by:

- **point-in-time correctness:** what was known on the analysis date, not only today’s restated value;
- **lineage:** source, CIK/accession, reporting period, retrieval time, content hash, and transform;
- **reproducibility:** immutable inputs, model version, deterministic outputs, and fixed random seeds;
- **model governance:** assumptions, limitations, validation fixtures, sensitivities, and human override logs;
- **data integrity:** adjusted/unadjusted price policy, missing-data gates, corporate-action handling,
  fiscal-calendar alignment, and no silent substitution; and
- **human usability:** a short conclusion first, with formulas, evidence, and detail available on demand.

## 3. Hosting and cost architecture

There is no credible permanent one-time-payment option for a dynamic financial application. Compute,
bandwidth, storage, domains, security maintenance, and market-data rights recur. An owned server only
converts a cloud bill into hardware, electricity, ISP, backup, and security work.

The lowest-cost durable design is:

| Service | Demo choice | Current official price reference |
| --- | --- | --- |
| Next.js hosting | Keep Vercel | [Hobby $0; Pro $20/month](https://vercel.com/pricing). Hobby is for personal/non-commercial use. |
| PostgreSQL | Neon Free | [Free: 100 CU-hours/project and 0.5 GB; Launch: $0.106/CU-hour](https://neon.com/pricing). Scale-to-zero resumes automatically. |
| Alternative database/auth | Supabase only if its integrated auth/storage is worth the trade-off | [Free: 500 MB and pauses after one inactive week; Pro from $25/month](https://supabase.com/pricing). |
| Global quota/cache | Add Upstash before fundamentals is promoted beyond low-traffic demo use; reuse it for licensed data later | [Free: 500K commands/month; PAYG $0.20/100K commands](https://upstash.com/pricing/redis). |
| Future Python API | Railway only when optimization/ETL needs it | [Free becomes $1/month after trial; Hobby has a $5 minimum with $5 usage](https://railway.com/pricing). |

Expected monthly bands:

- Portfolio demo: **$0–5**, excluding an optional paid AI tier.
- Public non-commercial MVP with persistence: **$0–25**.
- Small professional application without market-data rights: **$25–75**.
- Licensed public financial application with explicitly advertised display rights: **about
  $999–2,500+ at steady state**, dominated by data licensing. A lower EOD-only negotiated quote is
  possible but must not be budgeted until it is received in writing.

## 4. Cross-instance quota, in plain language

Vercel may run multiple copies of the same API at once. Imagine several cashiers:

- a counter stored inside one cashier does not know what another cashier served;
- the current Vercel WAF is the front-door guard and limits each visitor across all cashiers;
- a shared Redis counter is the store-wide inventory ledger and limits the total vendor calls made by
  every visitor and every cashier together.

The current 60 requests/minute/IP WAF rule controls one abusive visitor. It does not guarantee that
1,000 different visitors cannot collectively exhaust SEC fair-access capacity or a paid provider
quota. The SEC adapter already sends the configured contact User-Agent, spaces calls to at most about
6.7 requests/second **inside one runtime instance**, deduplicates in-flight requests, and applies
edge/resource caching. That is not a deployment-wide ceiling when Vercel starts several instances.

Before promoting fundamentals beyond low-traffic portfolio/demo use, add Upstash with three budgets:
per-user burst, global SEC/provider requests/minute, and global requests/day. The global SEC budget
must remain within the SEC's published fair-access guidance; licensed providers use their contracted
limits. If a global budget is exhausted, return cached/stale-labelled data or a clear
temporary-unavailable response; never silently switch providers or invent values.

## 5. Database and identity decision

**Selected direction:** Neon Postgres plus Auth.js when saved cloud portfolios enter scope. Do not add
a database merely to claim PostgreSQL on a résumé.

Minimum tables:

- `users`, `accounts`, and `verification_tokens` for identity ownership; add `sessions` if Auth.js
  uses database sessions instead of JWT sessions;
- `companies` for ticker, CIK, SEC SIC, exchange, and canonical name;
- `portfolios` and `holdings` for user-owned portfolio definitions;
- `assumption_sets` for immutable, versioned DCF inputs;
- `valuation_snapshots` and `analysis_snapshots` for immutable model outputs, including
  `engine_version`, `method_version`, `input_hash`, and `random_seed` where simulation is used;
- `source_records` for source URL, accession, period, retrieved time, and content hash;
- `peer_sets` and `peer_members` for candidates, scores, analyst decision, and override reason;
- `memo_documents` and `memo_claim_sources` for claim-to-citation mapping; and
- `audit_log` as append-only who/what/when/before/after evidence.

Do not store full historical price series in the 0.5 GB demo database. Store analysis receipts,
hashes, dates, and derived snapshots. Large licensed source datasets belong in provider storage or
object storage under the governing license.

**Needed from the owner when this phase starts:** authorize a Neon project and choose the login
method. Recommended first login is GitHub OAuth for a portfolio project; email magic links can be
added if non-GitHub users become a real audience.

## 6. Automated peers and sector allocation

### Free, defensible MVP

The SEC publishes filer SIC codes and company filing metadata. SIC is coarse and not equivalent to
GICS, so the UI must say **“SEC SIC + analyst-reviewed heuristic.”** The peer process is:

1. Build a US-listed candidate universe from SEC submissions.
2. Start with the same four-digit SIC; widen to a documented parent group only when too few peers
   remain.
3. Exclude incompatible listing region, security type, and financial structure.
4. Compare log revenue, market-cap band when licensed data exists, operating margin, growth, asset
   intensity, and profitability state.
5. Normalize features, calculate a disclosed weighted distance, and show the reasons for the top
   candidates.
6. Require the user/analyst to include or exclude each final peer and record the reason.
7. Freeze the peer set and method version into the valuation snapshot.

Sector allocation can initially use an explicitly labelled internal mapping derived from SEC SIC.
[GICS is the exclusive property of MSCI and S&P Dow Jones Indices](https://www.msci.com/legal/notice-and-disclaimer),
so InvestIQ must not label unlicensed classifications as GICS.

**Cost:** SEC SIC and the algorithm are $0. Better normalized industries, market caps, and public
display can come through the selected commercial dataset. Intrinio Startup is $333/month for the
first six months, $666/month for the next six, and $999/month thereafter; the steady-state licensing
baseline is therefore $999/month. Enterprise classification products generally require a quote.

## 7. Company-specific DCF and financial analysis

SEC Company Facts supports reported facts but does not provide analyst forecasts. The engine must
separate:

- reported facts: revenue, EBIT/operating income, tax, D&A, capex, working capital, cash, debt,
  diluted shares, with filing receipts;
- deterministic derived metrics: margins, growth, ROIC components, leverage, coverage, and
  efficiency ratios;
- user/model assumptions: forecast growth, margin path, tax, reinvestment, WACC, and terminal
  growth; and
- interpretation: neutral text that cannot alter inputs or outputs.

Company-specific defaults should use historical medians/trends only when coverage gates pass. Every
default remains editable and labelled as an assumption. The engine must not manufacture unavailable
quick-ratio, inventory-turnover, or interest-coverage inputs. Sector medians require a licensed or
documented peer dataset.

Validation sources include the [SEC XBRL API contract](https://www.sec.gov/edgar/sec-api-documentation)
and Aswath Damodaran’s [DCF input guidance](https://www.stern.nyu.edu/~adamodar/pdfiles/dcfinput.pdf)
and [valuation spreadsheets](https://pages.stern.nyu.edu/~adamodar/New_Home_Page/eqspread.htm).

## 8. Python/FastAPI decision gate

Do not move existing deterministic ratios or DCF math to Python solely for résumé keywords. Add a
small stateless FastAPI analytics service only when at least one of these is approved:

- constrained minimum-variance/efficient-frontier optimization with SciPy or CVXPY;
- Ledoit–Wolf covariance shrinkage and robust matrix diagnostics;
- Monte Carlo workloads that exceed acceptable Vercel execution time;
- scheduled multi-company ETL; or
- reusable analytics needed by both web and a future mobile client.

The service contract must be versioned and tested against shared JSON fixtures so TypeScript UI and
Python cannot disagree. Railway Hobby is the simplest initial deployment; no account or payment is
needed until this gate is reached.

Portfolio optimization requirements:

- long-only, weights sum to one, configurable weight caps;
- explicit lookback, return frequency, risk-free rate, rebalance frequency, and transaction costs;
- covariance estimator and positive-semidefinite handling disclosed;
- out-of-sample comparison, turnover, sensitivity, and failure diagnostics;
- deterministic Monte Carlo seed; and
- educational language, never a recommended allocation.

The theoretical basis begins with Markowitz, [“Portfolio Selection” (1952)](https://doi.org/10.1111/j.1540-6261.1952.tb01525.x).
For unstable high-dimensional sample covariance, use Ledoit and Wolf,
[“A well-conditioned estimator for large-dimensional covariance matrices” (2004)](https://doi.org/10.1016/S0047-259X(03)00096-4).

## 9. Investment Memo AI research assistant

The assistant is a constrained explainer, not an autonomous analyst. Its allowed context is SEC
facts and filing excerpts, a frozen DCF snapshot, frozen peer metrics, user-authored notes, and
portfolio outputs. Every factual claim must map to a source/date; assumptions and interpretations
must use separate labels. The model cannot create a missing metric, change a valuation, or issue a
buy/sell recommendation.

Generative prose is not deterministic even at a temperature of zero, so it is excluded from the
platform's deterministic-calculation guarantee. Its governance standard is instead auditability:
store `model_name`, model/version identifier, `prompt_hash`, context/input hash, generation time, and
claim-to-source mapping; reject unsupported citations; and require a user review before a memo is
marked final. The deterministic calculations included in its context remain independently
reproducible.

For production privacy, use a paid Gemini tier because Google states that paid-tier content is not
used to improve its products, while free-tier content may be. Current Gemini pricing is token-based;
the [official pricing page](https://ai.google.dev/gemini-api/docs/pricing) remains the controlling
source. The endpoint also requires authentication, a per-user limit, global AI budget, prompt-size
limit, output schema validation, and prompt-injection tests.

## 10. Final research PDF and three-minute demo

The complete Equity Research Report PDF is the recruiter/interviewer artifact that proves the
platform can convert data into a controlled analyst workflow. It should be generated only after the
company-specific DCF and peer workflow are stable. Target sections:

1. company overview and revenue drivers;
2. historical financial quality and evidence receipts;
3. bear/base/bull DCF and sensitivity tables;
4. analyst-reviewed peer comparison;
5. catalysts, risks, and disconfirming evidence;
6. portfolio impact where applicable;
7. limitations, methodology version, data timestamp, and source list.

The three-minute demo video lets a recruiter understand the project without installing code. It is
not a marketing animation. The final recording should show the research question, company workflow,
DCF sensitivity, portfolio risk, cited memo, and the architecture/validation evidence. Record it only
after the routes and terminology stop changing; otherwise every UI revision makes the video stale.

## 11. Delivery order and gates

1. **Completed:** Production SEC contact configuration and live AAPL/MSFT/GOOG fundamentals checks.
2. **Completed locally, remote authorization pending:** GitHub Actions workflow runs typecheck,
   lint, the Vitest suite, and Production build. Local evidence on 2026-08-01 was produced by
   `npm run check && npm run build`: 18 test files and 511 tests passed. Commit `4007a22` is waiting
   for the signed-in GitHub OAuth grant to add the `workflow` scope before GitHub will accept the
   workflow file.
3. **Next:** complete remaining company financial ratios with XBRL coverage gates and source receipts.
4. **Next:** build company-specific DCF defaults and immutable assumption/output snapshots.
5. **Then:** implement SEC-SIC peer candidates, scoring explanations, analyst override, and internal
   sector allocation.
6. **Then:** add Neon + Auth.js only when cloud-saved portfolios are part of the release.
7. **Then:** add the citation-bound Investment Memo assistant with production privacy and budgets.
8. **Later gate:** FastAPI optimization, minimum variance, efficient frontier, and periodic
   rebalancing.
9. **Final artifacts:** full Equity Research PDF, stabilized demo video, README evidence, and public
   deployment.

At every stage, a feature is complete only when its calculations, data lineage, failure states,
beginner explanation, tests, and deployment behavior have all been verified.
