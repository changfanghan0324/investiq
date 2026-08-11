# ModelGuard error sample manifest

`modelguard-error-model.xlsx` is a deterministic golden fixture. It contains no market data.
Each seeded defect has an expected rule ID:

| Seeded defect | Expected rule |
| --- | --- |
| Balance sheet imbalances in 2025E–2027E | MG-ACC-001 |
| Cash reconciliation mismatch | MG-ACC-002 |
| Retained earnings bridge mismatch | MG-ACC-003 |
| Debt schedule mismatch | MG-ACC-004 |
| DCF diluted share mismatch | MG-ACC-005 / MG-DCF-009 |
| Forecast hardcode and abrupt revenue step | MG-ASM-004 / MG-ASM-006 |
| WACC 7%, terminal growth 8% | MG-DCF-001 |
| FCFF mismatch | MG-DCF-002 |
| Discount factor sequence anomaly | MG-DCF-003 |
| Forecast FCFF PV mismatch | MG-DCF-004 |
| Invalid WACC/terminal-growth denominator; terminal formula is cannot-verify | MG-DCF-005 |
| Terminal PV mismatch | MG-DCF-006 |
| Enterprise value bridge mismatch | MG-DCF-007 |
| Equity value bridge mismatch | MG-DCF-008 |
| Identical Bear/Base/Bull assumptions and output with no normalized formulas | MG-SCN-001 / MG-SCN-005 |
| Missing WACC source/owner | MG-ASM-001 / MG-ASM-002 / MG-ASM-003 |
| External workbook reference | MG-STR-005 |
