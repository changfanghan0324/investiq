# ModelGuard deterministic rule catalogue

Rules are versioned by stable IDs. An issue is a review signal, not an accounting conclusion,
valuation claim, investment recommendation, or professional certification. Every rule emits a
passed, failed, not-applicable, or cannot-verify check when its mapped scope is encountered.

## Spreadsheet, structure, and linkage integrity — 11 rules

| Rule ID | Severity | Trigger |
| --- | --- | --- |
| `MG-STR-001` | critical | Formula text or cached result includes an Excel error token |
| `MG-STR-002` | medium | Formula has no stored cached result, so its output cannot be verified |
| `MG-STR-003` | critical | Formula names a worksheet absent from the parsed workbook |
| `MG-STR-004` | critical | A1 reference points to a cell with no parsed value or formula |
| `MG-STR-005` | medium | External workbook/link metadata is present and deliberately not followed |
| `MG-STR-006` | info | Worksheet is hidden or very hidden and needs explicit review |
| `MG-STR-007` | info | Hidden rows or columns can conceal inputs, formulas, or supporting evidence |
| `MG-STR-008` | info | Merged ranges can obscure the cell that owns an input or formula |
| `MG-STR-009` | info | Defined names are preserved for reviewer traceability and version receipts |
| `MG-STR-010` | warning | A formula directly references its own cell; Excel iteration is not executed |
| `MG-STR-011` | medium | Formula coverage has a gap between populated formula periods |

## Accounting integrity — 5 rules

| Rule ID | Severity | Trigger |
| --- | --- | --- |
| `MG-ACC-001` | critical | Assets do not equal liabilities plus equity by mapped period |
| `MG-ACC-002` | high | Beginning cash plus net change does not equal ending cash |
| `MG-ACC-003` | high | Beginning retained earnings plus net income less dividends plus defined adjustments does not equal ending retained earnings |
| `MG-ACC-004` | high | Current debt plus long-term debt does not equal schedule total, or schedule total does not reconcile to balance-sheet debt |
| `MG-ACC-005` | high | DCF diluted shares do not match the mapped input share count |

## DCF integrity — 11 rules

| Rule ID | Severity | Trigger |
| --- | --- | --- |
| `MG-DCF-001` | critical | Terminal growth is greater than or equal to WACC |
| `MG-DCF-002` | high | FCFF does not reconcile to EBIT after cash tax plus D&A less CapEx less change in NWC |
| `MG-DCF-003` | high | Discount factors do not decline across mapped periods |
| `MG-DCF-004` | high | PV FCFF does not equal FCFF multiplied by its discount factor |
| `MG-DCF-005` | high | Gordon-growth terminal value does not reconcile when the denominator is valid |
| `MG-DCF-006` | high | PV terminal value does not equal terminal value multiplied by its discount factor |
| `MG-DCF-007` | high | Enterprise value does not bridge from forecast PVs plus PV terminal value |
| `MG-DCF-008` | high | Equity value does not bridge from enterprise value, net debt, and other adjustments |
| `MG-DCF-009` | high | Implied share value does not equal equity value divided by diluted shares |
| `MG-DCF-010` | medium | PV terminal value exceeds the configured 80% ModelGuard review threshold of enterprise value |
| `MG-DCF-011` | medium | Terminal-year FCFF is not positive for a conventional positive-growth terminal case |

## Scenario integrity — 5 rules

| Rule ID | Severity | Trigger |
| --- | --- | --- |
| `MG-SCN-001` | high | Bear, Base, and Bull core assumptions are identical |
| `MG-SCN-002` | medium | Bear/Base/Bull assumptions violate the documented ordering heuristic |
| `MG-SCN-003` | high | Scenario output ordering does not follow Bear ≤ Base ≤ Bull |
| `MG-SCN-004` | high | Core assumptions change materially but mapped output does not change |
| `MG-SCN-005` | medium | No normalized scenario formulas are available to inspect |

## Assumption governance — 6 rules

| Rule ID | Severity | Trigger |
| --- | --- | --- |
| `MG-ASM-001` | medium | An assumption has no source or basis |
| `MG-ASM-002` | medium | An assumption has no owner |
| `MG-ASM-003` | medium | WACC or terminal growth is not explicitly marked as an analyst assumption |
| `MG-ASM-004` | medium | The first forecast revenue step exceeds the configured 20% review threshold |
| `MG-ASM-005` | medium | The first forecast operating margin changes by more than the configured 10 percentage-point threshold |
| `MG-ASM-006` | medium | A forecast-period Income Statement value is hardcoded instead of formula-linked |

The clean golden workbook passes all 38 published rules. The error golden workbook intentionally
contains structural, accounting, DCF, scenario, and assumption defects; it is expected to be
`Not ready`. Missing cached results, unavailable mappings, external links, and absent sheets are
never replaced with zeros or inferred values. New rules require a stable ID, a fixture, boundary
coverage, and a regression test.
