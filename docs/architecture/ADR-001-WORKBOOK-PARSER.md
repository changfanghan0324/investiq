# ADR-001: Browser workbook parser adapter

Status: accepted for implementation

## Decision

ModelGuard exposes a narrow `WorkbookParser` adapter and runs it inside a dedicated Web Worker.
The adapter receives an `ArrayBuffer` and returns a normalized, non-mutating `ParsedWorkbook`.
The first implementation will use ExcelJS (MIT) behind the adapter so the UI and audit engine do
not depend on a library-specific object graph.

## Options considered

| Option | License / browser posture | Formula text and cached values | Names, hidden/merged cells, external links | Worker / security / maintenance | Decision |
| --- | --- | --- | --- | --- | --- |
| ExcelJS | MIT; browser bundle supported with documented browser build | Reads formula text and result fields when present | Worksheet visibility, merged ranges, defined names and hyperlinks are available; external links must be surfaced as metadata and never fetched | Worker-friendly after bundling; active project; larger bundle than a custom reader | **Selected** |
| SheetJS Community | Apache-2.0 community package; browser supported | Strong cell/formula coverage, but cached-value and feature behavior varies by option | Broad workbook surface; some advanced features are commercial or represented less directly | Mature but requires careful option pinning and provenance; commercial feature boundary is a review concern | Rejected for first adapter |
| Custom ZIP/XML reader | No third-party runtime license; browser possible | Can preserve exact XML text and cached values | Full fidelity requires implementing many ECMA-376 parts and relationship safety rules | Small initial surface but a high maintenance and security burden; easy to miss hidden/external metadata | Rejected |
| Server-side parser | Varies | Usually broad | Broadest runtime access | Violates the no-upload and zero-server-processing contract | Rejected |

## Required adapter behavior

- Accept `.xlsx` only and enforce the central workbook limits before and during parsing.
- Never follow external links, formulas, images, macros, or network relationships.
- Preserve worksheet name/visibility, merged ranges, named ranges, formula text, cached value,
  number format, and cell coordinates in the normalized schema.
- Surface unsupported features as deterministic warnings rather than silently filling values.
- Run in a worker so cancellation can terminate parsing and release the input buffer.

## Consequences

The adapter is replaceable if licensing, bundle size, or fidelity requirements change. A parser
upgrade requires fixture tests for formulas, cached values, names, hidden sheets, merged cells,
external-link detection, file limits, and cancellation before it can ship.
