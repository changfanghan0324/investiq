import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { auditWorkbook, compareWorkbooks } from "@/domain/modelguard-audit";
import { workbookParser } from "@/services/modelguard-parser";
import { auditReportToCsv, auditReportToJson, auditReportToPdf } from "@/services/modelguard-exports";

async function parse(name: string) {
  const buffer = await readFile(`public/samples/${name}`);
  return workbookParser.parse(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength), { fileName: name });
}

describe("ModelGuard deterministic audit", () => {
  it("keeps the clean fixture free of critical issues", async () => {
    const report = auditWorkbook(await parse("modelguard-clean-model.xlsx"));
    expect(report.summary.critical).toBe(0);
    expect(report.summary.high).toBe(0);
    expect(report.modelStatus).toBe("Ready for review");
    expect(report.issues).toEqual([]);
  });

  it("surfaces broken references in the error fixture", async () => {
    const report = auditWorkbook(await parse("modelguard-error-model.xlsx"));
    expect(report.summary.critical).toBeGreaterThan(0);
    expect(report.issues.some((issue) => issue.ruleId === "MG-STR-004")).toBe(true);
    expect(report.issues.some((issue) => issue.ruleId === "MG-STR-006")).toBe(true);
    expect(report.issues.some((issue) => issue.ruleId === "MG-ACC-001")).toBe(true);
    expect(report.issues.some((issue) => issue.ruleId === "MG-DCF-007")).toBe(true);
    expect(report.issues.some((issue) => issue.ruleId === "MG-SCN-001")).toBe(true);
  });

  it("compares workbook versions by sheet and cell", async () => {
    const before = await parse("modelguard-version-1.xlsx");
    const after = await parse("modelguard-version-2.xlsx");
    const changes = compareWorkbooks(before, after);
    expect(changes.some((change) => change.kind === "changed" && change.sheet === "Inputs")).toBe(true);
  });

  it("exports JSON, CSV, and a local PDF payload", async () => {
    const report = auditWorkbook(await parse("modelguard-error-model.xlsx"));
    expect(auditReportToJson(report)).toContain('"schemaVersion": "1.0"');
    expect(auditReportToCsv(report).split("\n")[0]).toContain("Issue ID");
    expect(new TextDecoder().decode(auditReportToPdf(report).slice(0, 8))).toBe("%PDF-1.4");
  });

  it("guards CSV formula injection", () => {
    const report = { schemaVersion: "1.0" as const, generatedAt: "2026-08-10T00:00:00.000Z", fileName: "=unsafe.xlsx", workbookSha256: "0", provenance: { sourceType: "user-local" as const, provider: "browser" as const, generatedAt: "2026-08-10T00:00:00.000Z", disclaimer: "local" }, issues: [{ id: "1", ruleId: "X", severity: "warning" as const, category: "formula" as const, title: "=formula", message: "safe", observed: "=unsafe" }], checks: [], summary: { critical: 0, high: 0, medium: 0, warning: 1, info: 0, passed: 0, cannotVerify: 0, notApplicable: 0 }, modelStatus: "Ready with limitations" as const };
    expect(auditReportToCsv(report)).toContain("'=formula");
    expect(auditReportToCsv(report)).toContain("'=unsafe");
  });
});
