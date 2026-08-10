import type { AuditReport, VersionChange } from "@/domain/modelguard-audit";

function safeCsvCell(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  const guarded = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return /[",\n]/.test(guarded) ? `"${guarded.replaceAll('"', '""')}"` : guarded;
}

export function auditReportToJson(report: AuditReport): string {
  return JSON.stringify(report, null, 2);
}

export function auditReportToCsv(report: AuditReport): string {
  const rows = [["Issue ID", "Rule", "Severity", "Category", "Sheet", "Cell", "Title", "Message", "Observed", "Expected"]];
  for (const issue of report.issues) rows.push([issue.id, issue.ruleId, issue.severity, issue.category, issue.sheet ?? "", issue.address ?? "", issue.title, issue.message, issue.observed ?? "", issue.expected ?? ""]);
  return rows.map((row) => row.map(safeCsvCell).join(",")).join("\n");
}

export function versionChangesToCsv(changes: VersionChange[]): string {
  const rows = [["Change", "Sheet", "Cell", "Before", "After"]];
  for (const change of changes) rows.push([change.kind, change.sheet, change.address, change.before?.formula ?? String(change.before?.value ?? ""), change.after?.formula ?? String(change.after?.value ?? "")]);
  return rows.map((row) => row.map(safeCsvCell).join(",")).join("\n");
}

function pdfEscape(value: string): string { return value.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)").replaceAll("\n", " "); }

/** A small dependency-free text PDF keeps exports local and deterministic. */
export function auditReportToPdf(report: AuditReport): Uint8Array {
  const lines = [`ModelGuard audit: ${report.fileName}`, `Generated: ${report.generatedAt}`, `Critical: ${report.summary.critical}  Warning: ${report.summary.warning}  Info: ${report.summary.info}`, "", ...report.issues.map((issue) => `${issue.severity.toUpperCase()} ${issue.ruleId} ${issue.sheet ? `${issue.sheet}!${issue.address ?? ""}` : ""} — ${issue.title}`)];
  const stream = ["BT", "/F1 10 Tf", "50 760 Td", ...lines.flatMap((line, index) => [index === 0 ? `(${pdfEscape(line)}) Tj` : `0 -14 Td (${pdfEscape(line)}) Tj`]), "ET"].join("\n");
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>", `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
  let pdf = "%PDF-1.4\n"; const offsets: number[] = [0];
  objects.forEach((object, index) => { offsets[index + 1] = pdf.length; pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = pdf.length; pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n `).join("\n")}\ntrailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(pdf);
}
