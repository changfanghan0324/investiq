/** Provenance for a workbook kept in the browser; no market data is implied. */
export interface WorkbookProvenance {
  sourceType: "user-local" | "sample-local";
  provider: "browser" | "ModelGuard sample library";
  generatedAt: string;
  disclaimer: string;
}

export type CellKind = "blank" | "value" | "formula" | "error";

export interface CellRecord {
  address: string;
  row: number;
  column: number;
  kind: CellKind;
  value: string | number | boolean | null;
  formula?: string;
  cachedValue?: string | number | boolean | null;
  numberFormat?: string;
}

export interface ParsedSheet {
  name: string;
  state: "visible" | "hidden" | "veryHidden";
  cells: CellRecord[];
  mergedRanges: string[];
}

export interface DefinedNameRecord {
  name: string;
  ranges: string[];
}

export interface ParsedWorkbook {
  schemaVersion: "1.0";
  fileName: string;
  fileSizeBytes: number;
  sha256: string;
  parsedAt: string;
  provenance: WorkbookProvenance;
  sheets: ParsedSheet[];
  definedNames: DefinedNameRecord[];
  externalLinks: string[];
  warnings: string[];
  stats: {
    nonEmptyCells: number;
    formulas: number;
    worksheets: number;
    parseMilliseconds: number;
  };
}

export interface WorkbookParser {
  parse(input: ArrayBuffer, context?: { fileName?: string; provenance?: WorkbookProvenance }): Promise<ParsedWorkbook>;
}
