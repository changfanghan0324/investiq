import ExcelJS from "exceljs";
import { assertWorkbookSize, WORKBOOK_LIMITS } from "@/domain/modelguard-limits";
import type { CellRecord, ParsedSheet, ParsedWorkbook, WorkbookParser, WorkbookProvenance } from "@/domain/modelguard-schema";

const DEFAULT_PROVENANCE: WorkbookProvenance = {
  sourceType: "user-local",
  provider: "browser",
  generatedAt: "",
  disclaimer: "Workbook content is processed locally and is not uploaded. ModelGuard does not provide investment advice.",
};

async function sha256(input: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", input);
  return [...new Uint8Array(digest)].map((part) => part.toString(16).padStart(2, "0")).join("");
}

function scalar(value: unknown): string | number | boolean | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object" && "text" in value && typeof value.text === "string") return value.text;
  return String(value);
}

function cellRecord(cell: ExcelJS.Cell): CellRecord | null {
  const value = cell.value as unknown;
  if (value === null || value === undefined || value === "") return null;
  const formulaValue = typeof value === "object" && value !== null && "formula" in value
    ? value as { formula: string; result?: unknown }
    : null;
  const isError = typeof value === "object" && value !== null && "error" in value;
  return {
    address: cell.address,
    row: cell.fullAddress.row,
    column: cell.fullAddress.col,
    kind: formulaValue ? "formula" : isError ? "error" : "value",
    value: formulaValue ? null : scalar(value),
    formula: formulaValue?.formula,
    cachedValue: formulaValue ? scalar(formulaValue.result) : undefined,
    numberFormat: cell.numFmt,
  };
}

export class ExcelJsWorkbookParser implements WorkbookParser {
  async parse(input: ArrayBuffer, context?: { fileName?: string; provenance?: WorkbookProvenance }): Promise<ParsedWorkbook> {
    assertWorkbookSize(input.byteLength);
    const started = performance.now();
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(input);
    if (workbook.worksheets.length > WORKBOOK_LIMITS.maxWorksheets) throw new Error("Workbook has too many worksheets");
    const sheets: ParsedSheet[] = [];
    let nonEmptyCells = 0;
    let formulas = 0;
    const warnings: string[] = [];
    for (const worksheet of workbook.worksheets) {
      const cells: CellRecord[] = [];
      worksheet.eachRow({ includeEmpty: false }, (row) => {
        row.eachCell({ includeEmpty: false }, (cell) => {
          const record = cellRecord(cell);
          if (!record) return;
          cells.push(record);
          nonEmptyCells += 1;
          if (record.kind === "formula") formulas += 1;
          if (nonEmptyCells > WORKBOOK_LIMITS.maxNonEmptyCells) throw new Error("Workbook has too many non-empty cells");
          if (formulas > WORKBOOK_LIMITS.maxFormulas) throw new Error("Workbook has too many formulas");
        });
      });
      const state = worksheet.state === "veryHidden" ? "veryHidden" : worksheet.state === "hidden" ? "hidden" : "visible";
      const model = worksheet.model as unknown as { merges?: string[] };
      const hiddenRows: number[] = [];
      worksheet.eachRow({ includeEmpty: true }, (row) => { if (row.hidden) hiddenRows.push(row.number); });
      const hiddenColumns = worksheet.columns.filter((column) => column.hidden).map((column) => column.letter).filter((letter): letter is string => Boolean(letter));
      sheets.push({ name: worksheet.name, state, cells, mergedRanges: model.merges ?? [], hiddenRows, hiddenColumns });
      if (performance.now() - started > WORKBOOK_LIMITS.maxParseMilliseconds) throw new Error("Workbook parsing exceeded the time limit");
    }
    const definedNames = (workbook.definedNames.model ?? []).map((entry) => ({ name: entry.name, ranges: [...entry.ranges] }));
    if (definedNames.length > WORKBOOK_LIMITS.maxNamedRanges) throw new Error("Workbook has too many named ranges");
    const model = workbook.model as unknown as { externalLinks?: Array<{ target?: string }> };
    const externalLinks = (model.externalLinks ?? []).map((link) => link.target ?? "external-link");
    if (externalLinks.length) warnings.push("External links were detected and were not followed.");
    if (nonEmptyCells === 0) throw new Error("BLANK_WORKBOOK");
    const parsedAt = new Date().toISOString();
    return {
      schemaVersion: "1.0",
      fileName: context?.fileName ?? "workbook.xlsx",
      fileSizeBytes: input.byteLength,
      sha256: await sha256(input),
      parsedAt,
      provenance: { ...DEFAULT_PROVENANCE, ...context?.provenance, generatedAt: context?.provenance?.generatedAt || parsedAt },
      sheets,
      definedNames,
      externalLinks,
      warnings,
      stats: { nonEmptyCells, formulas, worksheets: sheets.length, parseMilliseconds: Math.round(performance.now() - started) },
    };
  }
}

export const workbookParser = new ExcelJsWorkbookParser();
