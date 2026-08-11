# ModelGuard normalized schema

Every parsed workbook returns `schemaVersion: "1.0"`, a local SHA-256, parser timestamp, limits
receipt, workbook provenance, sheet metadata, cell records, defined names, external-link metadata,
warnings, and parse statistics. Cell records preserve address, row/column, kind, formula text,
cached value, display value, and number format.

The parser never writes back to the workbook. Audit reports reference the workbook hash and never
pretend that a missing cached value is a recalculated value.
