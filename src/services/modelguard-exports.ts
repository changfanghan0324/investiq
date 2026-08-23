import type { AuditReport, VersionChange, VersionFindingChange } from "@/domain/modelguard-audit";

function safeCsvCell(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  const guarded = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return /[",\n]/.test(guarded) ? `"${guarded.replaceAll('"', '""')}"` : guarded;
}

export function auditReportToJson(report: AuditReport): string {
  return JSON.stringify(report, null, 2);
}

export function auditReportToCsv(report: AuditReport): string {
  const rows: unknown[][] = [["Issue ID", "Rule", "Status", "Severity", "Category", "Sheet", "Cell", "Period", "Title", "Message", "Observed", "Expected", "Difference", "Tolerance", "Why it matters", "Impact", "Remediation", "How to verify", "Potential false positive", "Potential false negative"], ["ModelGuard version", "1.0"], ["Rule version", "1.0"], ["Generated at", report.generatedAt], ["Model file", report.fileName], ["Model SHA-256", report.workbookSha256], ["Source type", report.provenance.sourceType], ["Provider", report.provenance.provider], ["Provenance generated at", report.provenance.generatedAt], ["Provenance disclaimer", report.provenance.disclaimer], ["Worksheets", report.workbookStats?.worksheets ?? ""], ["Formulas", report.workbookStats?.formulas ?? ""], ["Model status", report.modelStatus], ["Critical", report.summary.critical], ["High", report.summary.high], ["Medium", report.summary.medium], ["Passed", report.summary.passed], ["Could not verify", report.summary.cannotVerify], ["Not applicable", report.summary.notApplicable], ["Limitations", (report.limitations ?? []).join(" | ")], []];
  for (const issue of report.issues) rows.push([issue.id, issue.ruleId, issue.status ?? "failed", issue.severity, issue.category, issue.sheet ?? "", issue.address ?? "", issue.period ?? "", issue.title, issue.message, issue.observed ?? "", issue.expected ?? "", issue.difference ?? "", issue.tolerance ?? "", issue.whyItMatters ?? "", issue.impact ?? "", issue.remediation ?? "", issue.howToVerify ?? "", issue.potentialFalsePositive ?? "", issue.potentialFalseNegative ?? ""]);
  return rows.map((row) => row.map(safeCsvCell).join(",")).join("\n");
}

export function versionChangesToCsv(changes: VersionChange[]): string {
  const rows = [["Change", "Change type", "Sheet", "Cell", "Before formula/value", "After formula/value", "Before cached value", "After cached value"]];
  for (const change of changes) rows.push([change.kind, change.changeType ?? "", change.sheet, change.address, change.before?.formula ?? String(change.before?.value ?? ""), change.after?.formula ?? String(change.after?.value ?? ""), String(change.before?.cachedValue ?? ""), String(change.after?.cachedValue ?? "")]);
  return rows.map((row) => row.map(safeCsvCell).join(",")).join("\n");
}

export function versionFindingsToCsv(changes: VersionFindingChange[]): string {
  const rows = [["Status", "Rule", "Severity", "Category", "Sheet", "Cell", "Period", "Before", "After"]];
  for (const change of changes) rows.push([change.status, change.ruleId, change.severity, change.category, change.sheet ?? "", change.address ?? "", change.period ?? "", change.before?.message ?? "", change.after?.message ?? ""]);
  return rows.map((row) => row.map(safeCsvCell).join(",")).join("\n");
}

function pdfEscape(value: string): string { return value.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)").replaceAll("\n", " "); }

export interface AuditPdfOptions {
  versionComparison?: { newFindings: number; resolvedFindings: number; persistingFindings: number; changedFindings: number };
}

/** A small dependency-free text PDF keeps exports local and deterministic. */
export function auditReportToPdf(report: AuditReport, options?: AuditPdfOptions): Uint8Array {
  const stats = report.workbookStats;
  const version = options?.versionComparison;
  const lines = [`ModelGuard audit report`, `Model file: ${report.fileName}`, `Generated: ${report.generatedAt}`, `Model SHA-256: ${report.workbookSha256}`, `ModelGuard version: 1.0  Rule version: 1.0`, `Source: ${report.provenance.sourceType} · ${report.provenance.provider}`, `Worksheets: ${stats?.worksheets ?? "—"}  Formulas: ${stats?.formulas ?? "—"}`, `Status: ${report.modelStatus}`, `Critical: ${report.summary.critical}  High: ${report.summary.high}  Medium: ${report.summary.medium}  Info: ${report.summary.info}`, `Passed: ${report.summary.passed}  Cannot verify: ${report.summary.cannotVerify}  Not applicable: ${report.summary.notApplicable}`, ...(version ? ["", `Version comparison — Resolved: ${version.resolvedFindings}  Persisting: ${version.persistingFindings}  New: ${version.newFindings}  Changed: ${version.changedFindings}`] : []), "", "Critical and High findings", ...report.issues.filter((issue) => issue.severity === "critical" || issue.severity === "high").map((issue) => `${issue.severity.toUpperCase()} ${issue.ruleId} ${issue.sheet ? `${issue.sheet}!${issue.address ?? ""}` : ""} — ${issue.title} — observed: ${issue.observed ?? "—"} — expected: ${issue.expected ?? "—"}`), "", "All findings", ...report.issues.map((issue) => `${issue.severity.toUpperCase()} ${issue.ruleId} ${issue.sheet ? `${issue.sheet}!${issue.address ?? ""}` : ""} — ${issue.title}`), "", "Limitations", ...(report.limitations ?? []), "This report is not accounting certification, investment advice, or a substitute for professional review."];
  const pageLines = Array.from({ length: Math.max(1, Math.ceil(lines.length / 45)) }, (_, page) => lines.slice(page * 45, page * 45 + 45));
  const pageIds = pageLines.map((_, index) => 3 + index);
  const fontId = 3 + pageLines.length;
  const contentIds = pageLines.map((_, index) => fontId + 1 + index);
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageLines.length} >>`];
  objects.push(...pageLines.map((_, index) => `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentIds[index]} 0 R >>`));
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  objects.push(...pageLines.map((page) => {
    const stream = ["BT", "/F1 10 Tf", "50 760 Td", ...page.flatMap((line, index) => [index === 0 ? `(${pdfEscape(line)}) Tj` : `0 -14 Td (${pdfEscape(line)}) Tj`]), "ET"].join("\n");
    return `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  }));
  let pdf = "%PDF-1.4\n"; const offsets: number[] = [0];
  objects.forEach((object, index) => { offsets[index + 1] = pdf.length; pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = pdf.length; pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n `).join("\n")}\ntrailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(pdf);
}
