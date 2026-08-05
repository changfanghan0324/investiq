# Final portfolio documentation and release-package review

Date: 2026-08-04  
Phase: recruiter-first README, social metadata, verified profile, repository presentation, usability protocol, and release-candidate documentation

## Codex proposal before independent review

1. Rebuild both root READMEs around the same recruiter-first information hierarchy: value proposition, current screenshots, demo and AAPL case, data-truth table, problem/solution/workflow, finance and analytics-engineering evidence, test evidence, limitations, architecture, quick start, documentation, author, license, and release status. Preserve detailed contracts in dedicated docs rather than deleting them.
2. Correct stale scope in both languages: market context instead of growth calculators; compare 2–5, portfolio 1–10, DCA 1–10; human-readable 100%/115%/130%/145% text sizes; completed AAPL case only after its phase passes.
3. Add canonical, Open Graph, Twitter, and generated branded social metadata with no price, return, or recommendation claim. Add contract tests.
4. Add a typed public profile whose only approved public contact is the existing GitHub URL. Null LinkedIn, email, and résumé fields must not render.
5. Keep root `CLAUDE.md` because the active repository workflow uses it. Keep tracked design history and the existing public project-summary PDF unless the owner asks to relocate or remove them; avoid unrelated file moves during release hardening.
6. Add an honest AI-assisted-development note that separates deterministic calculations/tests, Codex implementation, Claude review, and owner decisions.
7. Prepare—but do not claim execution of—a privacy-minimizing human-usability kit with the twelve owner-specified tasks and neutral results/issue/synthesis templates.
8. Prepare license comparison, release checklist, draft v1 notes, and known limitations. Do not choose a license, tag, merge, publish, or call v1 final. Treat license, participant study, and release approval as owner actions.
9. Capture seven clean Playwright screenshots from the branch build; place at most three in the README and link the remainder as a gallery. Validate English/Chinese, desktop/mobile/tablet, 145% text, axe, print styles, console errors, exports, forbidden copy, links, and runtime failure modes.

## Claude independent review

Claude Opus 5 independently reviewed the repository and Codex proposal in session
`7f3c1c5d-f890-4933-af5e-077a91424121` and returned **Conditional Go**. It required the live URL and
plain public-demo truth above the README fold; identified stale Growth Calculators, phantom Stock
Analysis, workspace-count, range, and market-source claims; capped the recruiter README at 250 lines;
required English/Chinese parity for truth, limitations, AI, author, license, and release status; and
required screenshots with an in-frame synthetic notice plus date/SHA provenance. It also required
canonical/social metadata without unsupported hreflang, an explicit no-license statement, null-safe
profile links, no fabricated usability rows, a draft-only release status, and an English-only PDF
limitation. It recommended retaining active root workflow/design artifacts and documenting the
generated summary PDF's dependency and drift risk.

## Codex decisions

- **Accepted:** rebuild both READMEs around recruiter scan order and move calculation contracts into
  four linked documents; preserve rather than summarize away method details.
- **Accepted:** exact public data-truth table, current route limits, human text-scale percentages,
  verified-profile config, canonical/OG/Twitter image contracts, all-rights-reserved/no-license
  status, draft release package, and empty privacy-minimizing usability templates.
- **Accepted:** keep package version at `0.1.0` and call the work a v1.0 release candidate, never a
  final release or tag.
- **Accepted:** keep `CLAUDE.md`, design history, and `output/pdf/InvestIQ_Project_Summary.pdf` in
  place. The PDF is a generated convenience artifact whose source/dependencies and possible drift
  must be checked before release.
- **Accepted:** no hreflang alternate links because locale is browser/local-storage state rather
  than separate crawlable URLs.
- **Deferred:** localized DCA PDF body. The web report path remains bilingual; English-only PDF is
  explicit in both READMEs and Known Limitations.

## Disagreement round

Codex challenged whether release cleanup justified moving root workflow files, design history, and
the existing summary PDF. The review evidence did not show that those files harmed recruiter scan
order once README links were curated. The resolution was to retain them, avoid unrelated moves, and
state that the generated PDF can drift from Markdown/application dependencies. No remaining
documentation disagreement blocks the release-candidate PR; license selection, real participant
testing, and release approval remain intentionally owner-owned.

## Post-implementation Claude product confirmation

Claude Opus 5 reviewed the complete baseline-to-`b2da093` committed diff in session
`7ebe93ea-df3c-47a7-a590-922b0b00eed8`. The first pass reached its tool-turn limit before answering;
the same session was resumed without further tools and returned **Conditional Go — accept the
implementation; open the PR non-draft**. Claude independently re-executed the AAPL builder and
confirmed the $62.723B bridge, all scenario/sensitivity outputs, unchanged DCF domain calls,
byte-identical generated Markdown, run-pinned live/synthetic mode across every leg/retry, and
synthetic truth in UI/CSV/PDF/AI.

Two requested corrections were accepted: both READMEs now require Node 24.x, and nullable terminal-
value share renders unavailable instead of zero. One merge gate remains: the case page intentionally
links to the generated sample on GitHub `main`; until this branch merges, that remote main file is the
old sample. The owner must verify the CTA after merge. Claude's remaining notes—synthetic-series
calibration, English-only PDF, SEC-path preview validation, and repository visibility—are documented
limitations/actions, not PR blockers.
