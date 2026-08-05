# AAPL Case Study Architecture Review

**Phase:** final portfolio release readiness — featured research case

**Codex proposal recorded:** 2026-08-04

**Implementation owner:** Codex

**Independent reviewer:** Claude Opus, highest available reasoning effort

This record separates the implementation owner's proposal from the independent review. It will be updated with Claude's findings, Codex's accept/reject decisions, one response round for material disagreements, and final verification evidence.

## Codex proposal before external review

> Historical proposal only. The $54.744B bridge, original bull CapEx, scenario outputs, and grid span below were superseded by the reviewed decision record. They remain here to preserve the review trail.

### Product decision

Keep the title **AAPL Research Case Study** and complete it as a real, dated research case rather than renaming it to a workflow guide. The required balance-sheet bridge is available from the same FY2025 filing and balance-sheet date:

| Component | FY2025 value | Period end | SEC concept |
|---|---:|---|---|
| Current debt | $12.350B | 2025-09-27 | `LongTermDebtCurrent` |
| Noncurrent debt | $78.328B | 2025-09-27 | `LongTermDebtNoncurrent` |
| Cash and equivalents | $35.934B | 2025-09-27 | `CashAndCashEquivalentsAtCarryingValue` |
| Constructed net debt | $54.744B | 2025-09-27 | current debt + noncurrent debt − cash |

All three reported components resolve to accession `0000320193-25-000079`, filed 2025-10-31. No missing component is interpreted as zero.

### Evidence architecture

1. Add one typed, immutable AAPL case source module under `src/data/`. It will contain:
   - company identity and a dated FY2025 snapshot;
   - five-year reported observations needed for displayed historical readings;
   - filing/source identifiers and official URLs;
   - explicit ownership for every forecast assumption;
   - dated official narrative evidence for catalysts and risks;
   - thesis, invalidation conditions, unresolved questions, and limitations.
2. Reuse `SourceReceipt` and the existing SEC concept conventions rather than inventing a second provenance shape. Compact source IDs may point to a typed source register so URLs and filing metadata are not duplicated in every display string.
3. Add a pure case-study builder under `src/domain/` that:
   - validates period alignment for the net-debt bridge;
   - derives CAGR, margins, FCF, and trend observations from the typed facts;
   - translates labelled scenario assumptions into `DcfAssumptions`;
   - calls the existing `buildScenarioRange` and sensitivity functions;
   - emits no recommendation and performs no I/O, clock, random, or React-layer math.
4. Render both the web case and `docs/EQUITY_RESEARCH_SAMPLE_AAPL.md` from the same case contract. A focused contract test will prevent the public sample from drifting from the typed snapshot and will forbid a market-price comparison.

### Fact and assumption ownership

Every displayed input will carry one of these labels:

- **Reported:** direct SEC XBRL fact with receipt.
- **Constructed:** deterministic arithmetic from reported facts, with every component receipt.
- **Analyst scenario:** an explicit modelling choice owned by the case author; not attributed to Apple or the SEC.
- **Subsequent official update:** dated Apple/SEC evidence after the FY2025 snapshot; informative only and not silently mixed into FY2025 model anchors.

The model will use FY2025 reported revenue, diluted weighted-average shares, and aligned net debt. Historical starter statistics will be derived from the FY2021–FY2025 reported window. WACC, terminal growth, cash tax, and working-capital assumptions remain analyst-owned.

### Scenario design

The case will run three explicit five-year FCFF scenarios through the existing valuation domain. These are assumption stress tests, not targets or recommendations:

| Assumption | Bear | Base | Bull | Ownership |
|---|---:|---:|---:|---|
| Revenue growth | 1.0% | 4.0% | 6.5% | Analyst scenario, informed by 3.3% FY2021–FY2025 CAGR and 4.2% median annual growth |
| Operating margin | 28.5% | 30.3% | 32.0% | Analyst scenario, with 30.3% five-year median as context |
| Cash tax rate | 20.0% | 18.0% | 16.0% | Analyst scenario; the engine applies it to positive EBIT |
| D&A / revenue | 2.9% | 2.9% | 2.9% | Analyst scenario, rounded from the five-year aligned median |
| CapEx / revenue | 3.3% | 2.9% | 2.7% | Analyst scenario, with 2.9% five-year aligned median as context |
| ΔNWC / incremental revenue | 5.0% | 3.0% | 2.0% | Analyst scenario |
| WACC | 10.0% | 9.0% | 8.0% | Analyst scenario |
| Terminal growth | 2.0% | 2.5% | 3.0% | Analyst scenario |

Using the current domain function and the verified $54.744B net-debt bridge, the initial deterministic outputs are approximately $72.10, $111.74, and $175.83 per diluted share. The case will explain that terminal value represents approximately 68.1%, 74.1%, and 80.0% of enterprise value across those scenarios, making long-duration assumptions a primary limitation. No actual or synthetic market price will be displayed beside these outputs.

The base sensitivity grid will use WACC values 8.0%–10.0% and terminal growth values 1.5%–3.5%. Its interpretation will be derived from the computed cells: lower discount rates and higher terminal growth increase the implied result, and the valid base grid spans approximately $87.30–$157.65. The text will not select a preferred cell.

### Narrative evidence boundary

- Historical financial claims use the 2025 Form 10-K and its SEC receipts.
- Risks are drawn from the 2025 Form 10-K, including competition/product transitions, supply-chain concentration, regulation, tariffs/trade restrictions, FX, and margin pressure.
- A dated post-snapshot catalyst monitor may cite Apple's 2026 Q2 results (2026-04-30) for reported revenue growth, Services, installed-base, cash-flow, and capital-return updates. It will be labelled a subsequent update and will not alter the FY2025 DCF anchors.
- The thesis will remain conditional. Each catalyst/risk will link to an official source and an observable metric or invalidation condition.

### UI and document structure

The case will present, in order:

1. scope, snapshot date, and educational boundary;
2. evidence ledger and source register;
3. historical financial observations;
4. net-debt bridge;
5. conditional thesis and evidence quality;
6. bear/base/bull assumptions and computed outputs;
7. sensitivity interpretation;
8. catalysts and risks with official source links;
9. invalidation conditions and unresolved questions;
10. methodology/limitations and links to the reusable product workspaces.

The current “Open live AAPL research” primary action will be removed. Workspace links may appear only as secondary product-navigation links clearly separated from the stable case evidence.

### Tests required before acceptance

- period-aligned net-debt construction and missing-component fail-closed behavior;
- expected AAPL net-debt value and three component receipts;
- deterministic historical observations from typed inputs;
- exact scenario outputs through the existing DCF function;
- sensitivity shape, valid cells, and deterministic interpretation;
- source register integrity and official HTTPS URLs;
- rendered public sample agrees with the typed case and contains no local/dated market-price comparison;
- English/Chinese case rendering, keyboard reachability, 320 px overflow, and axe checks.

### Deliberate non-changes

- No valuation formula, bound, or finance-domain behavior change.
- No live or synthetic ticker-price comparison in the public case.
- No peers, market multiples, recommendations, target price, or fabricated narrative source.
- No fallback from missing debt to zero.

## Claude independent review

**Reviewer run:** Claude Opus 5, `--effort max`, read-only

**Session:** `8db8a2e0-2f6b-445e-a932-d159d95e4798`

**Duration / cost reported by Claude CLI:** 677.9 seconds / $3.027875

**Verdict:** Conditional go. Claude independently reproduced the proposal's $54.744B three-component bridge, all three per-share scenario outputs, terminal-value percentages, grid span, revenue CAGR, median annual growth, and median operating margin. It found no DCF arithmetic or valuation-domain change requirement, but blocked publication until five P0 concerns were addressed.

### Claude P0 findings

1. **Debt/liquidity scope:** the proposed bridge excluded Apple commercial paper and all marketable securities. Claude argued that calling $54.744B simply “net debt” would overstate the breadth of the construction and appear wrong to an equity-research reviewer.
2. **Bull reinvestment:** 2.7% CapEx/revenue below 2.9% D&A/revenue was inconsistent with a 6.5% growth case.
3. **Provenance shape:** `SourceReceipt` cannot honestly represent 10-K narrative sections, press releases, management-stated metrics, or analyst assumptions.
4. **Localization:** user-visible prose in `src/data/` would violate the `t()` catalog contract.
5. **Starter labels:** the live valuation workspace calls median-derived growth/margin/CapEx/D&A starters “CAGR” or “latest,” contradicting what the code actually calculates.

### Claude P1 findings accepted for decision

- Display `FUNDAMENTALS_DISCLAIMER` verbatim.
- Distinguish management-stated installed-base evidence from reported XBRL facts.
- Add reported effective-tax context and clarify unsupported ΔNWC ownership.
- Carry both diluted weighted-average and point-in-time share counts where available.
- Explain that five forecast years matches the reusable workspace and makes terminal-value reliance material.
- Generate the Markdown sample and assert byte equality rather than relying on spot checks.
- Label any subsequent official update with fiscal period, published date, as-of boundary, and manual-transcription provenance.
- Explain that the sensitivity range holds every non-discount assumption at base; verify monotonicity from computed cells.
- Add a compact AAPL companyfacts selection fixture, recommendation-language guard, displayed bridge identity, font-scale/reduced-motion/browser checks, and independent review of the derived builder.
- Lead with the case summary and move receipts/technical tables behind progressive disclosure.

### Claude challenges

- Preserve the useful lesson that a DCF can differ substantially from a traded price, without displaying the unlicensed quote or numerical comparison.
- Do not call the middle scenario a central estimate: “base” must mean a mid-assumption set, not most likely.
- Avoid words such as “verified,” “required,” “prevent,” and “valid” when the evidence supports a narrower statement.
- Resolve the tension between a stable case and a dated quarterly update.

## Codex decision record

### Accepted

1. **Commercial paper omission is a reproducible data-selection defect.** The FY2025 10-K reports $8.0B of commercial paper; SEC XBRL reports `CommercialPaper` of $7.979B at 2025-09-27. The current selector only captures the $12.350B current portion of term debt. The case and valuation prefill will be corrected to use $20.329B current debt = $7.979B commercial paper + $12.350B current term debt. With $78.328B noncurrent term debt and $35.934B cash, the stated-scope DCF bridge becomes **$62.723B**. A failing selection/contract test will precede the fix.
2. **Marketable securities scope disclosure.** The 10-K reports $18.763B current and $77.723B noncurrent marketable securities. They will be shown as broader liquidity context with receipts and explicitly excluded from the task-specified DCF formula. The DCF row will be named “DCF net debt — stated scope,” not an unqualified comprehensive net-debt claim.
3. **Bull reinvestment correction.** Bull CapEx/revenue will be 3.1%, above 2.9% D&A/revenue. The revised deterministic outputs, using the $62.723B bridge, are approximately $71.57 / $111.20 / $172.63 for bear/base/bull. These remain scenario outputs, not targets.
4. **Separate honest provenance shapes.** `SourceReceipt` remains unchanged for selected XBRL facts. A language-neutral narrative citation will carry document type, publication/filing date, period end where applicable, section, URL, and manual-transcription status. Analyst assumptions carry ownership and rationale, not a fake receipt.
5. **Language-neutral data.** The typed case holds numbers, dates, source identifiers, enums, and i18n keys only. All displayed prose lives in both catalogs. The generated public Markdown will remain English-only and will state that the web case is bilingual.
6. **Starter-label truth fix.** Correct English/Chinese valuation labels to say median or aligned historical ratio where the implementation computes those values. No formulas change.
7. **Generated sample.** Add a deterministic generator and a byte-equality contract test for `docs/EQUITY_RESEARCH_SAMPLE_AAPL.md`.
8. **Evidence tiers and disclaimer.** Display the required later-restatements disclaimer verbatim; label management-stated metrics separately from XBRL facts.
9. **Assumption context.** Add effective-tax history. Keep ΔNWC explicitly analyst-owned because the standardized facts do not support a complete operating-working-capital bridge; do not construct a partial proxy and present it as comprehensive.
10. **Share convention.** Carry both weighted-average diluted shares and point-in-time shares. Use weighted-average diluted shares to remain aligned with the existing workspace, while exposing that choice as a limitation.
11. **Five-year rationale and TV dependence.** Explain that the horizon matches the reusable workspace and disclose the resulting 68%–80% terminal-value share.
12. **Sensitivity and tests.** Verify all 25 case-grid cells, derived monotonicity, a separate invalid-cell domain test, fixture selection, displayed arithmetic, copy guards, localization, font-scale, reduced motion, mobile, and accessibility.
13. **Progressive disclosure.** Lead with the conclusion boundary and computed scenario panel; move detailed receipts and source register to expandable sections.
14. **No-price calibration lesson.** Preserve the conceptual warning that model outputs can differ greatly from traded prices, while showing neither a quote nor a numerical comparison.
15. **Base semantics.** Keep the required bear/base/bull names but define “base” as the mid-assumption set, not a probability-weighted central estimate or forecast.

### Partially accepted

1. **Stable case versus latest update:** retain one clearly separated “subsequent official update” panel, now using Apple's latest fiscal Q3 2026 results published 2026-07-30 for the quarter ended 2026-06-27. It will be dated, manually transcribed, excluded from the FY2025 model, and framed as evidence to monitor. This preserves the requested official catalyst evidence without pretending the stable FY2025 snapshot auto-updates.
2. **Source-register reuse:** reuse existing XBRL receipt/source concepts where doing so does not create a `src/data → src/services` dependency. Shared source-register transformation may be promoted to a neutral module instead of importing a report service into case data.

### Rejected or constrained

1. **Subtracting marketable securities in the DCF bridge:** rejected for this task because the owner-specified acceptance formula is current debt + noncurrent debt − cash on one balance date, and the existing valuation contract uses that scoped input. Marketable securities will be disclosed prominently, not silently netted into a different formula.
2. **Constructing ΔNWC from inventory + receivables − payables:** rejected as incomplete. It would omit other operating current assets/liabilities and could create a more misleading anchor than an explicitly analyst-owned assumption.
3. **Renaming bear/base/bull:** constrained by the requested case format. The UI will retain the names and neutralize “base” with an explicit ownership/meaning label.

## Disagreement response round

**Reviewer:** same Claude Opus 5 session, `--effort max`, read-only

**Duration / incremental cost reported by Claude CLI:** 272.9 seconds / $1.1387125

### Claude response

Claude accepted the two rejected/partial decisions and gave a final **GO for implementation** with one bounded condition:

- The commercial-paper correction must be alias-aware. `DebtCurrent` and `ShortTermBorrowings` may already include commercial paper; `LongTermDebtCurrent` does not. Adding `CommercialPaper` as a normal alias would select one fact rather than sum it, while blindly adding it could double-count other issuers.
- The pre-fix test must cover: Apple-style `LongTermDebtCurrent + CommercialPaper`; a comprehensive `DebtCurrent` issuer with no double-count; an issuer without commercial paper that remains available; and a commercial-paper fact on a different period end that is not combined.

Claude independently confirmed:

- $20.329B current debt = $7.979B commercial paper + $12.350B current term debt;
- $62.723B DCF net debt = $20.329B + $78.328B − $35.934B;
- revised bear/base/bull outputs of approximately $71.57 / $111.20 / $172.63;
- terminal-value shares remain approximately 68.1% / 74.1% / 80.0%;
- revised base sensitivity-grid span is approximately $86.77–$157.12.

Claude judged **“DCF net debt — stated scope” professionally defensible** because the convention is explicit, conservative, reproducible in the product, and accompanied by the excluded $96.486B marketable-securities balance. Conditions accepted by Codex:

1. Apply the qualified scope label in the case, generated sample, both languages, and the reusable valuation hint.
2. Keep marketable-securities context adjacent to the bridge rather than hiding it in a collapsed receipt register.
3. Explain that including those securities in a broader liquidity convention would increase each scenario by about $6.43/share, without presenting a second headline range.
4. Add a qualitative sentence that positive ΔNWC is a deliberately conservative analyst assumption relative to Apple's reported working-capital position; do not fabricate a partial historical ratio.
5. Add the distinct starter-label key, Chinese numeric-parity checks, and the revised sensitivity span.

### Final architecture decision

Proceed with the reviewed architecture. First land the four-case failing commercial-paper selection test and alias-aware fix. Then build the typed case from the corrected selected facts, generate the English Markdown from it, render bilingual UI prose via i18n keys, and complete the independent calculation/code review before accepting the phase.

## Final implementation and verification

Pending.
