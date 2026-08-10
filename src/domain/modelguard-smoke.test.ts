import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { auditWorkbook } from "@/domain/modelguard-audit";
import { auditReportToCsv, auditReportToJson, auditReportToPdf } from "@/services/modelguard-exports";
import { workbookParser } from "@/services/modelguard-parser";

const fixtures = [
  { name: "modelguard-smoke-three-statement-dcf.xlsx", sheets: ["Income Statement", "Balance Sheet", "Cash Flow", "DCF"] },
  { name: "modelguard-smoke-dcf-only.xlsx", sheets: ["Inputs", "DCF"] },
  { name: "modelguard-smoke-fpa-forecast.xlsx", sheets: ["Inputs", "Income Statement", "Cash Flow"] },
] as const;

async function parse(name: string) {
  const buffer = await readFile(`public/samples/${name}`);
  return workbookParser.parse(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength), { fileName: name });
}

describe("ModelGuard real-workbook-shaped smoke fixtures", () => {
  it.each(fixtures)("parses, audits, and exports $name without inference", async ({ name, sheets }) => {
    const workbook = await parse(name);
    const report = auditWorkbook(workbook);
    expect(workbook.stats.formulas).toBeGreaterThan(0);
    expect(sheets.every((sheet) => workbook.sheets.some((candidate) => candidate.name === sheet))).toBe(true);
    expect(report.provenance.sourceType).toBe("user-local");
    expect(report.provenance.disclaimer).toContain("locally");
    expect(() => auditReportToJson(report)).not.toThrow();
    expect(() => auditReportToCsv(report)).not.toThrow();
    expect(new TextDecoder().decode(auditReportToPdf(report).slice(0, 8))).toBe("%PDF-1.4");
  });

  it("keeps incomplete DCF and FP&A shapes explicitly unavailable", async () => {
    expect(auditWorkbook(await parse("modelguard-smoke-dcf-only.xlsx")).summary.cannotVerify).toBeGreaterThan(0);
    expect(auditWorkbook(await parse("modelguard-smoke-fpa-forecast.xlsx")).summary.cannotVerify).toBeGreaterThan(0);
  });
});
