# ModelGuard usability walkthroughs

These five internal acceptance walkthroughs were run against the public Preview and production
builds after the ModelGuard pivot. They are product smoke walkthroughs, not a recruited-user
research study.

| # | Task | Result | Evidence |
| --- | --- | --- | --- |
| 1 | From Home, choose **Try the sample model** and complete the clean audit without opening a file picker. | Pass — `/workspace?sample=clean`, `Ready for review`, Critical 0, High 0, 51 checks. | `docs/screenshots/modelguard/home.png` |
| 2 | Upload the error workbook, find one accounting and one DCF issue, then expand the evidence. | Pass — MG-ACC-001 and MG-DCF-001 show sheet/cell, observed, expected, and how-to-verify text. | `docs/screenshots/modelguard/finding-detail.png` |
| 3 | Load Version 1 and Version 2 and compare them. | Pass — New 1, Resolved 3, Persisting 0, including MG-SCN-004. | `docs/screenshots/modelguard/version-comparison.png` |
| 4 | Export the audit receipt and clear the session. | Pass — PDF and CSV controls trigger local downloads; Clear this session removes the report from the DOM. | Preview browser run |
| 5 | Switch to Simplified Chinese, set 145% text, and inspect a mobile viewport. | Pass — no horizontal overflow at 145%; 390px mobile screenshot remains readable and keyboard/a11y CI is green. | `docs/screenshots/modelguard/mobile.png` |

Known follow-up: a larger study with external analysts should measure completion time, finding
comprehension, and whether the formula-cache limitation is understood without prompting.
