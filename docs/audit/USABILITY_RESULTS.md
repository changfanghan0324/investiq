# Structured usability evaluation

**Review date:** 2026-08-08
**Status:** proxy evaluation complete; human participant research not claimed

## Important limitation

The repository workflow cannot recruit or observe five real people. To avoid fabricating research,
this document reports five representative persona walkthroughs against the deterministic browser
flows and existing task protocol. The outcomes are product evidence and hypotheses for a later
moderated study, not participant quotes, demographics, or statistically valid completion rates.

The requested study design remains: two finance users and three non-finance users, five tasks, first-
click and completion observation, confusion notes, and a short post-task confidence question.

## Proxy participants and tasks

| Persona | Background | Primary tasks |
| --- | --- | --- |
| F1 | Equity-research analyst | Find AAPL; verify a filing receipt; inspect valuation assumptions |
| F2 | Portfolio analyst | Load a two-security comparison; interpret common-window risk; open methodology |
| N1 | Beginner investor | Find the public-demo disclosure; distinguish SEC facts from synthetic market data |
| N2 | Product manager | Build a small portfolio; change text size; complete the form with keyboard focus |
| N3 | Recruiter/general reader | Scan the homepage; open the case study; identify limitations and no-advice boundary |

## Walkthrough result matrix

“Completed” means the scripted browser path reached the intended state without an application error;
it does not mean a human found the task easy.

| Task | F1 | F2 | N1 | N2 | N3 | Evidence / finding |
| --- | --- | --- | --- | --- | --- | --- |
| Find company research | Completed | Completed | Completed | Completed | Completed | Labelled ticker input, validation message, and direct company route |
| Separate real SEC evidence from synthetic market data | Completed | Completed | Completed | Completed | Completed | Public-demo notice and source-basis language are visible before analysis |
| Inspect a calculation/receipt | Completed | Completed | Completed with methodology link | Completed with methodology link | Completed with case-study source list | Progressive disclosure keeps receipts and formulas available |
| Complete a comparison or portfolio task | Completed | Completed | Completed | Completed | Not required | Bounds are explicit (2–5 compare, 1–10 portfolio) and invalid states stay actionable |
| Change language/text scale and continue by keyboard | Completed | Completed | Completed | Completed | Completed | English/zh-CN catalogs, 100–145% scale options, labels, focus, and compact viewport checks |

## Findings and decisions

1. **Evidence boundary was the strongest comprehension aid.** Keep the public-demo notice close to
   the first action and repeat the basis in result/export surfaces.
2. **A beginner needs the difference between “ticker label” and “security history” stated in plain
   language.** The homepage and workspace disclosures now use that wording rather than relying on a
   technical legend.
3. **Advanced controls should remain discoverable but quiet.** The unused DCA ellipsis/menu control
   was removed; advanced assumptions remain in an explicit details group.
4. **Pluralization is a trust detail.** DCA result summaries now select holding/holdings by count,
   eliminating “1 holdings”.
5. **Localization must be catalog-owned.** Visible component copy no longer branches directly on
   `locale.startsWith("zh")`; the two catalogs carry the same key set.

## Follow-up moderated study

Before claiming human usability metrics in a future release, recruit the five specified people,
record task time and first click, ask the confidence question after each task, and publish anonymized
notes in `docs/usability/`. Do not use proxy completion as a substitute for those observations.
