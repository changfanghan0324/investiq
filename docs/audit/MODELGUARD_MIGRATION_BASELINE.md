# ModelGuard migration baseline

## Scope

InvestIQ is being pivoted in place to ModelGuard. The existing GitHub repository and Vercel
project remain the same so that history and rollback are preserved. The public hostname stays
`https://investiq-eight-xi.vercel.app/`.

## Rollback point

- Archive tag: `investiq-v1-before-modelguard`
- Migration branch: `codex/modelguard-in-place-migration`
- `origin/main` at migration start: `759706e1d19f875338775fb12eceee0136f73a38`
- Production deployment at migration start: `dpl_71H767UzYfAxf2U7my4FcteMKcTt`
- Existing synthetic-market disclosure fix: `4decddf7ee1503d479e9263802fc0ab2318ed620`

The archive tag is a recoverable source-control rollback point; no production alias was changed
as part of creating it.

## Baseline evidence

Before the pivot, the repository passed the direct TypeScript, ESLint, Vitest, and Next build
checks (35 test files, 657 tests). The old production health endpoint returned unavailable
service status, which is one reason the new product removes runtime API dependencies rather than
trying to repair them. The current migration removes that endpoint from the active application.

## Review record

No Claude CLI or callable Claude reasoning/review tool is available in this environment. We do
not claim Claude approval. Product acceptance remains owned by Codex with deterministic tests,
the documented rule catalogue, and a second-pass self-review recorded in the final migration
report.
