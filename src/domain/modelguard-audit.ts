import type { CellRecord, ParsedWorkbook } from "@/domain/modelguard-schema";
import { runFinancialAudit, type FinanceAuditPolicy } from "@/domain/modelguard-finance-audit";

export type AuditSeverity = "critical" | "high" | "medium" | "warning" | "info";
export type AuditCategory = "formula" | "linkage" | "assumption" | "dcf" | "scenario" | "structure" | "accounting";
export type AuditStatus = "passed" | "failed" | "not-applicable" | "cannot-verify";

export interface AuditIssue {
  id: string;
  ruleId: string;
  severity: AuditSeverity;
  category: AuditCategory;
  title: string;
  message: string;
  sheet?: string;
  address?: string;
  period?: string;
  observed?: string;
  expected?: string;
  difference?: string;
  tolerance?: string;
  whyItMatters?: string;
  howToVerify?: string;
  confidence?: "high" | "medium" | "low";
  status?: AuditStatus;
}

export interface AuditCheck {
  ruleId: string;
  category: AuditCategory;
  status: AuditStatus;
  severity?: AuditSeverity;
  sheet?: string;
  address?: string;
  period?: string;
}

export interface AuditReport {
  schemaVersion: "1.0";
  generatedAt: string;
  fileName: string;
  workbookSha256: string;
  provenance: ParsedWorkbook["provenance"];
  issues: AuditIssue[];
  checks: AuditCheck[];
  summary: {
    critical: number; high: number; medium: number; warning: number; info: number;
    passed: number; cannotVerify: number; notApplicable: number;
  };
  modelStatus: "Not ready" | "Needs review" | "Ready with limitations" | "Ready for review";
}

export interface VersionChange {
  kind: "added" | "removed" | "changed";
  sheet: string;
  address: string;
  before?: CellRecord;
  after?: CellRecord;
}

export type VersionFindingStatus = "new" | "resolved" | "persisting";

export interface VersionFindingChange {
  status: VersionFindingStatus;
  ruleId: string;
  category: AuditCategory;
  severity: AuditSeverity;
  sheet?: string;
  address?: string;
  period?: string;
  before?: AuditIssue;
  after?: AuditIssue;
}

// Unquoted Excel sheet names cannot contain operators. Keeping the unquoted branch
// deliberately narrow prevents `=B11-Inputs!B13` from being read as a sheet called
// `B11-Inputs`; sheet names containing spaces must use Excel's quoted form.
const SHEET_REFERENCE = /(?:'([^']+)'|(?<![A-Za-z0-9_.])([A-Za-z_][A-Za-z0-9_.]*))!/g;
const CELL_REFERENCE = /(?:'([^']+)'|(?<![A-Za-z0-9_.])([A-Za-z_][A-Za-z0-9_.]*))!\$?([A-Z]{1,3})\$?(\d+)/g;
const ERROR_TOKEN = /#(?:REF|DIV\/0|VALUE|NAME|N\/A|NUM|NULL)!?/i;

function issueId(ruleId: string, sheet: string | undefined, address: string | undefined, suffix = ""): string {
  return [ruleId, sheet ?? "workbook", address ?? "", suffix].join(":");
}

export function addIssue(issues: AuditIssue[], issue: Omit<AuditIssue, "id">): void {
  issues.push({
    status: "failed", confidence: "high",
    whyItMatters: "A reviewer should trace this finding before relying on the model output.",
    howToVerify: "Open the cited cell and compare the observed value with the expected condition.",
    ...issue, id: issueId(issue.ruleId, issue.sheet, issue.address, String(issues.length)),
  });
}

function cellDisplay(cell: CellRecord): string {
  if (cell.formula) return cell.formula;
  return cell.value === null ? "(blank)" : String(cell.value);
}

function runFormulaChecks(workbook: ParsedWorkbook, issues: AuditIssue[]): void {
  const sheetNames = new Set(workbook.sheets.map((sheet) => sheet.name));
  const cellsBySheet = new Map(workbook.sheets.map((sheet) => [sheet.name, new Set(sheet.cells.map((cell) => cell.address))]));
  for (const sheet of workbook.sheets) for (const cell of sheet.cells) {
    if (cell.kind !== "formula" || !cell.formula) continue;
    if (ERROR_TOKEN.test(cell.formula) || ERROR_TOKEN.test(String(cell.cachedValue ?? ""))) addIssue(issues, { ruleId: "MG-STR-001", severity: "critical", category: "formula", title: "Formula contains an error token", message: "The formula or cached result contains an Excel error token. Trace the reference before relying on this output.", sheet: sheet.name, address: cell.address, observed: cellDisplay(cell) });
    if (cell.cachedValue === null || cell.cachedValue === undefined) addIssue(issues, { ruleId: "MG-STR-002", severity: "medium", category: "formula", title: "Formula has no cached result", message: "This formula has no stored result in the workbook. ModelGuard cannot verify its output.", sheet: sheet.name, address: cell.address, observed: cell.formula, status: "cannot-verify" });
    SHEET_REFERENCE.lastIndex = 0;
    let reference: RegExpExecArray | null;
    while ((reference = SHEET_REFERENCE.exec(cell.formula)) !== null) {
      const referencedSheet = (reference[1] ?? reference[2]).trim();
      if (!sheetNames.has(referencedSheet)) addIssue(issues, { ruleId: "MG-STR-003", severity: "critical", category: "linkage", title: "Formula references a missing sheet", message: "The referenced worksheet is not present in the parsed workbook.", sheet: sheet.name, address: cell.address, observed: referencedSheet, expected: "An existing worksheet" });
    }
    CELL_REFERENCE.lastIndex = 0;
    let cellReference: RegExpExecArray | null;
    while ((cellReference = CELL_REFERENCE.exec(cell.formula)) !== null) {
      const referencedSheet = (cellReference[1] ?? cellReference[2]).trim();
      if (!sheetNames.has(referencedSheet)) continue;
      const referencedAddress = `${cellReference[3]}${cellReference[4]}`;
      if (!cellsBySheet.get(referencedSheet)?.has(referencedAddress)) addIssue(issues, { ruleId: "MG-STR-004", severity: "critical", category: "linkage", title: "Formula references an empty cell", message: "The formula points to a cell that has no parsed value or formula. Confirm the intended linkage.", sheet: sheet.name, address: cell.address, observed: `${referencedSheet}!${referencedAddress}`, expected: "A populated source cell" });
    }
    if (/\[[^\]]+\]/.test(cell.formula)) addIssue(issues, { ruleId: "MG-STR-005", severity: "medium", category: "structure", title: "External workbook reference was not followed", message: "ModelGuard detected an external workbook reference and did not access it.", sheet: sheet.name, address: cell.address, observed: cell.formula, status: "cannot-verify" });
  }
}

function runStructureChecks(workbook: ParsedWorkbook, issues: AuditIssue[]): void {
  for (const sheet of workbook.sheets) if (sheet.state !== "visible") addIssue(issues, { ruleId: "MG-STR-006", severity: "info", category: "structure", title: "Hidden worksheet requires review", message: "Hidden content is included but is not visible in a normal review path.", sheet: sheet.name, expected: "Review hidden worksheets explicitly", status: "cannot-verify" });
  for (const externalLink of workbook.externalLinks) addIssue(issues, { ruleId: "MG-STR-005", severity: "medium", category: "structure", title: "External link was not followed", message: "ModelGuard detected an external relationship and did not access it.", observed: externalLink, expected: "No external link or a reviewed local replacement", status: "cannot-verify" });
}

export function auditWorkbook(workbook: ParsedWorkbook, policy?: FinanceAuditPolicy): AuditReport {
  const issues: AuditIssue[] = [];
  runFormulaChecks(workbook, issues); runStructureChecks(workbook, issues);
  const finance = runFinancialAudit(workbook, policy);
  issues.push(...finance.issues);
  const checks = [...finance.checks];
  const summary = { critical: 0, high: 0, medium: 0, warning: 0, info: 0, passed: 0, cannotVerify: 0, notApplicable: 0 };
  for (const issue of issues) { summary[issue.severity] += 1; if (issue.status === "cannot-verify") summary.cannotVerify += 1; }
  for (const check of checks) { if (check.status === "passed") summary.passed += 1; if (check.status === "cannot-verify") summary.cannotVerify += 1; if (check.status === "not-applicable") summary.notApplicable += 1; }
  const modelStatus = summary.critical > 0 ? "Not ready" : summary.high > 0 ? "Needs review" : summary.medium > 0 ? "Ready with limitations" : "Ready for review";
  return { schemaVersion: "1.0", generatedAt: new Date().toISOString(), fileName: workbook.fileName, workbookSha256: workbook.sha256, provenance: workbook.provenance, issues, checks, summary, modelStatus };
}

function cellKey(sheet: string, address: string): string { return `${sheet}!${address}`; }

export function compareWorkbooks(before: ParsedWorkbook, after: ParsedWorkbook): VersionChange[] {
  const flatten = (workbook: ParsedWorkbook) => new Map(workbook.sheets.flatMap((sheet) => sheet.cells.map((cell) => [cellKey(sheet.name, cell.address), { sheet: sheet.name, cell }] as const)));
  const previous = flatten(before); const current = flatten(after); const keys = new Set([...previous.keys(), ...current.keys()]); const changes: VersionChange[] = [];
  for (const key of [...keys].sort()) { const [sheet, address] = key.split("!"); const beforeCell = previous.get(key)?.cell; const afterCell = current.get(key)?.cell; if (!beforeCell && afterCell) changes.push({ kind: "added", sheet, address, after: afterCell }); else if (beforeCell && !afterCell) changes.push({ kind: "removed", sheet, address, before: beforeCell }); else if (beforeCell && afterCell && JSON.stringify(beforeCell) !== JSON.stringify(afterCell)) changes.push({ kind: "changed", sheet, address, before: beforeCell, after: afterCell }); }
  return changes;
}

export function compareAuditFindings(before: AuditReport, after: AuditReport): VersionFindingChange[] {
  const key = (issue: AuditIssue): string => [issue.ruleId, issue.sheet ?? "workbook", issue.address ?? "", issue.period ?? ""].join("|");
  const previous = new Map(before.issues.map((issue) => [key(issue), issue]));
  const current = new Map(after.issues.map((issue) => [key(issue), issue]));
  const keys = [...new Set([...previous.keys(), ...current.keys()])].sort();
  return keys.map((issueKey) => {
    const beforeIssue = previous.get(issueKey);
    const afterIssue = current.get(issueKey);
    const issue = afterIssue ?? beforeIssue!;
    return {
      status: beforeIssue && afterIssue ? "persisting" : afterIssue ? "new" : "resolved",
      ruleId: issue.ruleId,
      category: issue.category,
      severity: issue.severity,
      sheet: issue.sheet,
      address: issue.address,
      period: issue.period,
      before: beforeIssue,
      after: afterIssue,
    };
  });
}
