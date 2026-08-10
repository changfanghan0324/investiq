# ModelGuard privacy contract

The selected workbook is read with `File.arrayBuffer()` and transferred to a dedicated Web Worker.
The worker parses and audits it without network access. The main thread receives normalized metadata
and issue receipts only for the active tab. There is no upload route, server action, database,
authentication, analytics beacon, market provider, SEC client, or AI request.

ModelGuard does not put workbook bytes, parsed sheets, formulas, or audit reports in
`localStorage`, `sessionStorage`, or IndexedDB. Browser language and text-size preferences are
the only optional persisted UI preferences inherited from the shell. Clear or close the workspace
to release the active in-memory references.
