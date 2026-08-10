import type { CellRecord, ParsedWorkbook } from "@/domain/modelguard-schema";

export type AuditSeverity = "critical" | "warning" | "info";
export type AuditCategory = "formula" | "linkage" | "assumption" | "dcf" | "scenario" | "structure";

export interface AuditIssue {
  id: string;
  ruleId: string;
  severity: AuditSeverity;
  category: AuditCategory;
  title: string;
  message: string;
  sheet?: string;
  address?: string;
  observed?: string;
  expected?: string;
}

export interface AuditReport {
  schemaVersion: "1.0";
  generatedAt: string;
  fileName: string;
  workbookSha256: string;
  provenance: ParsedWorkbook["provenance"];
  issues: AuditIssue[];
  summary: Record<AuditSeverity, number>;
}

export interface VersionChange {
  kind: "added" | "removed" | "changed";
  sheet: string;
  address: string;
  before?: CellRecord;
  after?: CellRecord;
}

const SHEET_REFERENCE = /(?:'([^']+)'|([A-Za-z_][A-Za-z0-9_ .-]*))!/g;
const CELL_REFERENCE = /(?:'([^']+)'|([A-Za-z_][A-Za-z0-9_ .-]*))!\$?([A-Z]{1,3})\$?(\d+)/g;
const ERROR_TOKEN = /#(?:REF|DIV\/0|VALUE|NAME|N\/A|NUM|NULL)!?/i;

function issueId(ruleId: string, sheet: string | undefined, address: string | undefined, suffix = ""): string {
  return [ruleId, sheet ?? "workbook", address ?? "", suffix].join(":");
}

function addIssue(issues: AuditIssue[], issue: Omit<AuditIssue, "id">): void {
  issues.push({ ...issue, id: issueId(issue.ruleId, issue.sheet, issue.address, String(issues.length)) });
}

function cellDisplay(cell: CellRecord): string {
  if (cell.formula) return cell.formula;
  return cell.value === null ? "(blank)" : String(cell.value);
}

function runFormulaChecks(workbook: ParsedWorkbook, issues: AuditIssue[]): void {
  const sheetNames = new Set(workbook.sheets.map((sheet) => sheet.name));
  const cellsBySheet = new Map(workbook.sheets.map((sheet) => [sheet.name, new Set(sheet.cells.map((cell) => cell.address))]));
  for (const sheet of workbook.sheets) {
    for (const cell of sheet.cells) {
      if (cell.kind !== "formula" || !cell.formula) continue;
      if (ERROR_TOKEN.test(cell.formula) || ERROR_TOKEN.test(String(cell.cachedValue ?? ""))) {
        addIssue(issues, { ruleId: "FORMULA_ERROR_TOKEN", severity: "critical", category: "formula", title: "Formula contains an error token", message: "The formula or cached result contains an Excel error token. Trace the reference before relying on this output.", sheet: sheet.name, address: cell.address, observed: cellDisplay(cell) });
      }
      if (cell.cachedValue === null || cell.cachedValue === undefined) {
        addIssue(issues, { ruleId: "FORMULA_NO_CACHED_VALUE", severity: "warning", category: "formula", title: "Formula has no cached result", message: "This formula has no stored result in the workbook. Recalculate it in Excel before using the output.", sheet: sheet.name, address: cell.address, observed: cell.formula });
      }
      SHEET_REFERENCE.lastIndex = 0;
      let reference: RegExpExecArray | null;
      while ((reference = SHEET_REFERENCE.exec(cell.formula)) !== null) {
        const referencedSheet = (reference[1] ?? reference[2]).trim();
        if (!sheetNames.has(referencedSheet)) {
          addIssue(issues, { ruleId: "FORMULA_MISSING_SHEET", severity: "critical", category: "linkage", title: "Formula references a missing sheet", message: "The referenced worksheet is not present in the parsed workbook.", sheet: sheet.name, address: cell.address, observed: referencedSheet, expected: "An existing worksheet" });
        }
      }
      CELL_REFERENCE.lastIndex = 0;
      let cellReference: RegExpExecArray | null;
      while ((cellReference = CELL_REFERENCE.exec(cell.formula)) !== null) {
        const referencedSheet = (cellReference[1] ?? cellReference[2]).trim();
        if (!sheetNames.has(referencedSheet)) continue;
        const referencedAddress = `${cellReference[3]}${cellReference[4]}`;
        if (!cellsBySheet.get(referencedSheet)?.has(referencedAddress)) {
          addIssue(issues, { ruleId: "FORMULA_MISSING_CELL", severity: "critical", category: "linkage", title: "Formula references an empty cell", message: "The formula points to a cell that has no parsed value or formula. Confirm the intended linkage.", sheet: sheet.name, address: cell.address, observed: `${referencedSheet}!${referencedAddress}`, expected: "A populated source cell" });
        }
      }
    }
  }
}

function runStructureChecks(workbook: ParsedWorkbook, issues: AuditIssue[]): void {
  for (const sheet of workbook.sheets) {
    if (sheet.state !== "visible") {
      addIssue(issues, { ruleId: "HIDDEN_SHEET_REVIEW", severity: "info", category: "structure", title: "Hidden worksheet requires review", message: "Hidden content is included in the workbook but is not visible in a normal review path.", sheet: sheet.name, expected: "Review hidden worksheets explicitly" });
    }
  }
  for (const externalLink of workbook.externalLinks) {
    addIssue(issues, { ruleId: "EXTERNAL_LINK_BLOCKED", severity: "warning", category: "structure", title: "External link was not followed", message: "ModelGuard detected an external relationship and did not access it. Confirm the value and provenance manually.", observed: externalLink, expected: "No external link or a reviewed local replacement" });
  }
}

function runForecastChecks(workbook: ParsedWorkbook, issues: AuditIssue[]): void {
  const income = workbook.sheets.find((sheet) => /income|p&l|profit/i.test(sheet.name));
  if (!income) return;
  for (const cell of income.cells.filter((candidate) => candidate.column >= 3 && candidate.row > 4 && candidate.kind === "value")) {
    addIssue(issues, { ruleId: "FORECAST_HARDCODE", severity: "warning", category: "linkage", title: "Forecast cell is hardcoded", message: "A forecast-period value is hardcoded instead of linked by formula. Confirm that this is intentional and documented.", sheet: income.name, address: cell.address, observed: cellDisplay(cell), expected: "A formula or documented assumption" });
  }
}

function runDcfChecks(workbook: ParsedWorkbook, issues: AuditIssue[]): void {
  const inputs = workbook.sheets.find((sheet) => /^inputs?$/i.test(sheet.name));
  if (!inputs) return;
  let wacc: { value: number; address: string } | undefined;
  let terminalGrowth: { value: number; address: string } | undefined;
  for (const cell of inputs.cells) {
    if (cell.column !== 1 || cell.value === null) continue;
    const label = String(cell.value).toLowerCase();
    const valueCell = inputs.cells.find((candidate) => candidate.row === cell.row && candidate.column === 2);
    if (!valueCell || typeof valueCell.value !== "number") continue;
    if (label.includes("wacc")) wacc = { value: valueCell.value, address: valueCell.address };
    if (label.includes("terminal") && label.includes("growth")) terminalGrowth = { value: valueCell.value, address: valueCell.address };
  }
  if (wacc && terminalGrowth && terminalGrowth.value >= wacc.value) {
    addIssue(issues, { ruleId: "DCF_TERMINAL_GROWTH", severity: "critical", category: "dcf", title: "Terminal growth is not below WACC", message: "The Gordon-growth denominator is zero or negative when terminal growth is at least the discount rate.", sheet: inputs.name, address: terminalGrowth.address, observed: String(terminalGrowth.value), expected: `Less than WACC (${wacc.value})` });
  }
}

export function auditWorkbook(workbook: ParsedWorkbook): AuditReport {
  const issues: AuditIssue[] = [];
  runFormulaChecks(workbook, issues);
  runStructureChecks(workbook, issues);
  runForecastChecks(workbook, issues);
  runDcfChecks(workbook, issues);
  const summary: Record<AuditSeverity, number> = { critical: 0, warning: 0, info: 0 };
  for (const issue of issues) summary[issue.severity] += 1;
  return { schemaVersion: "1.0", generatedAt: new Date().toISOString(), fileName: workbook.fileName, workbookSha256: workbook.sha256, provenance: workbook.provenance, issues, summary };
}

function cellKey(sheet: string, address: string): string { return `${sheet}!${address}`; }

export function compareWorkbooks(before: ParsedWorkbook, after: ParsedWorkbook): VersionChange[] {
  const flatten = (workbook: ParsedWorkbook) => new Map(workbook.sheets.flatMap((sheet) => sheet.cells.map((cell) => [cellKey(sheet.name, cell.address), { sheet: sheet.name, cell }] as const)));
  const previous = flatten(before);
  const current = flatten(after);
  const keys = new Set([...previous.keys(), ...current.keys()]);
  const changes: VersionChange[] = [];
  for (const key of [...keys].sort()) {
    const [sheet, address] = key.split("!");
    const beforeCell = previous.get(key)?.cell;
    const afterCell = current.get(key)?.cell;
    if (!beforeCell && afterCell) changes.push({ kind: "added", sheet, address, after: afterCell });
    else if (beforeCell && !afterCell) changes.push({ kind: "removed", sheet, address, before: beforeCell });
    else if (beforeCell && afterCell && JSON.stringify(beforeCell) !== JSON.stringify(afterCell)) changes.push({ kind: "changed", sheet, address, before: beforeCell, after: afterCell });
  }
  return changes;
}
