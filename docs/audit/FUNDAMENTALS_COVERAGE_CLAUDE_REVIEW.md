# Claude independent review record

Recorded: 2026-08-06

## Reviewer and tool verification

Claude Code CLI 2.1.223 was installed from Anthropic's native signed distribution, authenticated to the
owner's first-party account, and verified with a real `claude-opus-5` high-effort reasoning call.
Review session: `2cab98a5-0e54-49bd-b561-4b496e5ca0fc`. Claude was read-only and was not treated as a
source of any financial fact.

## Objections raised

- Diagnose missing direct aliases before constructing revenue.
- Prevent circular gross-profit/revenue derivations by requiring depth-one direct components.
- Require exact annual period and accession; fail closed on cost-concept ambiguity.
- Do not allow unknown SIC to pass non-financial construction gates.
- Keep manual D&A as a valuation assumption, never a fundamentals fact.
- Remove `dcfAnchors` cross-year fallback.
- Do not label a generic positive margin or D&A value as historical.
- Align diluted EPS to the revenue anchor fiscal year and suppress P/E when EPS is non-positive.
- Preserve AAPL direct behavior and add financial-issuer negative fixtures.
- Update calculation-contract documentation in the same change.

## Accepted recommendations

All objections above were accepted. Revenue and D&A fallbacks require direct standard inputs, USD,
one full-year period, one accession, non-negative expense components and a known non-financial SIC.
Direct facts win by fiscal period. Historical starters require three aligned observations. Valuation
readiness and method suitability are pure functions with exact-fiscal-year anchors.

## Follow-up decision after official filing inspection

The official Fastly iXBRL fact is
`us-gaap:RevenueFromContractWithCustomerIncludingAssessedTax`, not a custom extension. Claude agreed
that adding the missing alias must classify FSLY revenue as `direct-standard`; intentionally selecting
the constructed identity would violate provenance. The alias is ordered after the excluding-assessed-
tax concept and before legacy `Revenues`. A real FSLY fixture proves the direct path and exact identity
reconciliation. A second synthetic variant removes only the direct concept to prove the fallback and
its two receipts.

## Rejected or modified recommendations

- “Ship the alias alone before the fallback” was modified to two small commits on one review branch:
  the selector/provenance/fallback domain commit, followed by readiness/UI. The code paths and tests
  remain independently reviewable.
- A general custom-extension parser was not implemented. The evidence proved it is unnecessary for
  FSLY, and the parser remains a separately feature-flagged P2 scope.

## Remaining disagreement or limitation

The original acceptance text required actual FSLY revenue to be “constructed-standard” with two
receipts. That is rejected because the official filing carries a direct standard fact. The corrected
acceptance is one direct receipt plus five exact aligned reconciliation records. The two-receipt
construction contract is covered by the no-direct synthetic fixture.

## Post-implementation review and disposition

Claude Opus 5 high-effort reviewed the actual branch diff in the same read-only session. It confirmed
the direct FSLY revenue alias, depth-one fallback, five zero-difference reconciliations, exact-year
valuation anchors, EV/Revenue default and loss-making P/E gate. Its initial verdict was `NOT READY FOR
PR` pending the following concrete issues:

- A cash-tax audit formula incorrectly said `/ revenue`; fixed to `/ pretaxIncome` with a regression test.
- PP&E depreciation-only coverage needed an explicit contract; the selector continues to reject it as
  combined D&A, the negative case is now explicit, and the governance docs explain why.
- Accession equality affected all constructed duration metrics without a named regression; operating
  margin now has a divergent-accession fail-closed test and the rule is documented.
- The fixture description overstated its evidentiary role; it is now called a curated offline acceptance
  fixture and links to the primary SEC filing.
- FY2021 EBITDA could appear beside FY2025 measures without a staleness cue; the Financials card now
  states that it is older evidence and names the latest company year.
- The reviewer could not finish the UI/i18n/a11y inspection before its first CLI tool-turn limit. Codex
  supplied the green typecheck, lint, unit, Playwright and production-build evidence plus the desktop,
  mobile, Simplified Chinese, 145% scaling, keyboard and axe artifacts in the final audit record.

The first review also called the uncommitted working tree a release blocker. That was procedural, not a
code defect; all reviewed implementation, governance and audit artifacts are committed before the PR is
created. The branch remains unmerged.
