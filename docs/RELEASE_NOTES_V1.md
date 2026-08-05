# InvestIQ v1.0 release candidate — draft notes

Status: **Draft only. Not a final v1.0 release.** Date: 2026-08-04.

InvestIQ is an evidence-first Investment Research & Portfolio Analytics platform connecting official
SEC evidence, explicit valuation assumptions, historical-risk calculations, and reproducible memo,
report, CSV, and PDF outputs.

## Candidate scope

- Company research, financial statements, DCF valuation, memo, and report.
- Completed AAPL evidence/assumption/scenario case study.
- 2–5 security comparison and 1–10 holding Portfolio Lab.
- Supporting Market Context and 1–10 holding Historical DCA.
- English/Simplified Chinese web UI, accessibility controls, and social metadata.

Company financials and filing receipts use real SEC EDGAR evidence. Public market workflows use
synthetic demo series, not actual ticker history. DCF uses the documented unlevered FCFF model and
never incorporates market price. Tests cover financial definitions, data lineage, disclosure,
accessibility, exports, and isolated browser workflows.

Automated test/E2E counts, preview URL, preview commit SHA, axe result, security controls, website,
and case-study links will be filled from final CI evidence in the pull request. Known limitations are
maintained in [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md).

No tag or release may be published until license, CI/preview, real participant-testing decision,
merge, and release approval are completed by the owner.

