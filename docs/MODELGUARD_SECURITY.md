# ModelGuard security model

- Static export and Vercel headers set a restrictive CSP, deny framing, disable unused browser
  permissions, and set a strict referrer policy.
- External workbook links are metadata only; the parser never follows them.
- Macros, images, external calculation engines, and unsupported workbook parts are not executed.
- Workbook and audit limits are enforced before and during parsing to bound memory and time.
- Exports escape CSV cells beginning with `=`, `+`, `-`, or `@` to reduce spreadsheet formula
  injection when a reviewer opens a CSV.
- The audit engine uses stable rule IDs and deterministic inputs. It does not claim accounting,
  valuation, or investment certification.

Security regression coverage should include a zero-network browser test, malicious formula text,
oversized files, external-link fixtures, cancellation, and export injection cases.
