# ADR-002: Static local-only runtime

Status: accepted

ModelGuard is exported as a static Next.js site. The audit workflow reads a user-selected
workbook in the browser, transfers an `ArrayBuffer` to a Web Worker, and keeps normalized data
only in memory for the active tab. There are no API routes, server actions, database calls,
authentication, uploads, analytics, market-data providers, or AI calls in the production runtime.

This makes the privacy promise testable: a zero-network browser test can open the workspace,
select a workbook, and assert that no request is made. Vercel remains the same static hosting
project; its redirects preserve old InvestIQ URLs without reintroducing server logic.
