# InvestIQ v1.0.0 — draft notes

Status: **Draft release prepared; final publication follows reviewed merge and production SHA
verification.** Date: 2026-08-08.

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

Local release validation at source commit `c6b649c` passed 34 Vitest files / 654 tests, TypeScript,
ESLint, production build, and isolated Playwright with 29 passed / 17 project-specific skips / 0
failures. Axe reported no critical/serious violations in tested home, case, and DCA flows; 320 px,
145% text, English/Chinese, blocked storage, print overflow, capability states, and CSV/PDF synthetic
provenance passed. The pull-request CI run `31278064408` passed both the quality and browser jobs on
the same SHA. Known limitations are maintained in [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md).

The structured usability review is a five-person proxy walkthrough and is explicitly not presented as
human participant research. The repository code and documentation use the MIT license; third-party
SEC/vendor display rights remain excluded. See the [audit set](audit/FINAL_PRODUCTION_AUDIT.md).

The v1.0.0 GitHub Release is prepared as a draft against the reviewed SHA. Final publication requires
the owner to merge the reviewed PR, verify the production deployment and metadata, then publish the
draft tag/release.
