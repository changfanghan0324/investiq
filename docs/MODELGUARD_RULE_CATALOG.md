# ModelGuard deterministic rule catalogue

Rules are versioned by stable IDs. An issue is a signal for review, not an investment conclusion.

| Rule ID | Severity | Category | Trigger |
| --- | --- | --- | --- |
| `FORMULA_ERROR_TOKEN` | critical | formula | Formula text or cached result includes an Excel error token |
| `FORMULA_NO_CACHED_VALUE` | warning | formula | Formula has no stored result in the workbook |
| `FORMULA_MISSING_SHEET` | critical | linkage | Formula names a worksheet absent from the parsed workbook |
| `FORMULA_MISSING_CELL` | critical | linkage | A1 reference points to a cell with no parsed value/formula |
| `FORECAST_HARDCODE` | warning | linkage | Forecast-period Income Statement cell is a hardcoded value |
| `DCF_TERMINAL_GROWTH` | critical | dcf | Terminal growth is greater than or equal to WACC |
| `HIDDEN_SHEET_REVIEW` | info | structure | Worksheet is hidden or very hidden |
| `EXTERNAL_LINK_BLOCKED` | warning | structure | External relationship is present and deliberately not followed |

The catalogue is intentionally conservative. A missing cached formula result is not replaced by a
new calculation, and an unavailable field remains unavailable. New rules require a fixture, a
stable ID, a user-readable message, and a regression test.
