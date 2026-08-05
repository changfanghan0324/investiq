# Public demo disclosure review

Date: 2026-08-04  
Phase: public synthetic-data disclosure, data-mode consistency, DCA readiness copy, and health-endpoint semantics

## Codex proposal before independent review

1. Put a visible, non-modal `Public demo mode` disclosure on the homepage with the owner-supplied English and Simplified Chinese body and detail. Keep an icon and text together so meaning does not depend on color.
2. Reuse one public-demo vocabulary across comparison, portfolio, market context, and DCA: real SEC filing evidence, licensed live market history, synthetic public-demo data, or unavailable. Existing workspaces may retain their local presentation component where a shared refactor would create needless regression risk, but their user-visible terms and export contracts must match.
3. Change synthetic result labels from claims about the named security to labels about a synthetic sample bearing that ticker label. CSV and PDF exports must say both `Synthetic public-demo series` and `Not actual market history`.
4. Add `dataMode: "synthetic-market"` to assistant summaries for demo reports and an explicit instruction that ticker-labelled synthetic output is not real performance. Do not change calculations or enable any licensed-data path.
5. Replace DCA `Server verified` with state-specific readiness language: checking waits for capability status, ready confirms live-data capability, and unavailable says the public demo is available while live market history is not enabled.
6. Keep `/api/health` as capability readiness for this release. Its intentional 503 is already consumed by the UI; splitting liveness/readiness without an actual uptime-monitoring requirement would add surface area and migration risk. Document the semantics and recommend a separate liveness route only when an external monitor needs it.
7. Add copy and payload contract tests, plus English/Chinese, 320 px, 145% text-size, export, and axe checks.

## Claude independent review

Claude Opus 5 reviewed the proposal and implementation independently in session
`f372f37e-be6d-4cb1-a86c-d3d003274875`. Its initial verdict was **Conditional Go**. It identified
four release-significant gaps: mode-inaccurate subtitles, insufficient DCA body/export disclosure,
assistant payloads that could describe synthetic output as historical ticker performance, and a
per-security live-to-demo fallback that could mix evidence modes. It also requested a complete 503
capability-readiness regression test and explicit documentation of the English-only PDF limitation.

After the first fixes, Claude confirmed P0-1 through P0-3 closed and accepted the minimum
all-or-nothing live/demo policy. In the required disagreement round it found a narrower retry path:
a single-security retry after readiness-cache expiry could still merge synthetic data into an
existing licensed-live run. That objection was valid.

## Codex decisions

- **Accepted:** mode-conditional subtitles; a shared icon-and-text disclosure; visible DCA body
  provenance; synthetic labels in the DCA tab, CSV, PDF header/footer/filename, and assistant
  payload; fail-safe server assistant instructions; exact 503/no-store tests.
- **Accepted:** prohibit per-security fallback. When licensed-live capability is selected, provider
  failure remains unavailable. The workspace now resolves `AnalysisDataMode` once per run and
  persists it for every security, benchmark request, and retry.
- **Accepted:** keep both the synthetic source warning and the educational/not-a-forecast warning
  on PDF page one.
- **Deferred, documented:** PDF body copy is English-only in this release. Source mode remains
  explicit in every locale and export, but PDF localization is a known limitation.
- **Kept by design:** `/api/health` remains a capability-readiness endpoint whose complete
  unavailable state intentionally returns 503. There is no external uptime-monitoring requirement
  justifying a second route in this release.
- **Kept for this deployment:** the homepage notice is unconditional because the public deployment
  is intentionally a synthetic market demo. Enabling a public-display license requires the release
  checklist item that changes this deployment-level statement.

## Disagreement round

Codex initially described the removal of provider-error fallback as sufficient to make mixed-mode
analytics impossible. Claude disagreed because retry independently re-resolved capability. Codex
accepted the counterexample and changed the contract: mode is now a run-level value, not a
per-request value. A pinned-mode regression test verifies that capability is not re-read. There is
no remaining disagreement that blocks this phase; Claude's remaining notes are documented product
limitations or non-blocking cleanup rather than claims of financial correctness.
