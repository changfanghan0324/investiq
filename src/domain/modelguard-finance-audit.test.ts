import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import type { ParsedWorkbook } from "@/domain/modelguard-schema";
import { runFinancialAudit } from "@/domain/modelguard-finance-audit";
import { workbookParser } from "@/services/modelguard-parser";

const RULE_IDS = [
  ...Array.from({ length: 5 }, (_, index) => `MG-ACC-${String(index + 1).padStart(3, "0")}`),
  ...Array.from({ length: 11 }, (_, index) => `MG-DCF-${String(index + 1).padStart(3, "0")}`),
  ...Array.from({ length: 5 }, (_, index) => `MG-SCN-${String(index + 1).padStart(3, "0")}`),
  ...Array.from({ length: 6 }, (_, index) => `MG-ASM-${String(index + 1).padStart(3, "0")}`),
];

async function parse(name: string): Promise<ParsedWorkbook> {
  const buffer = await readFile(`public/samples/${name}`);
  return workbookParser.parse(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength), { fileName: name });
}

function clone(workbook: ParsedWorkbook): ParsedWorkbook {
  return JSON.parse(JSON.stringify(workbook)) as ParsedWorkbook;
}

function cached(workbook: ParsedWorkbook, sheetName: string, address: string, value: number): void {
  const cell = workbook.sheets.find((sheet) => sheet.name === sheetName)?.cells.find((candidate) => candidate.address === address);
  if (!cell) throw new Error(`Missing ${sheetName}!${address}`);
  cell.cachedValue = value;
}

function raw(workbook: ParsedWorkbook, sheetName: string, address: string, value: number): void {
  const cell = workbook.sheets.find((sheet) => sheet.name === sheetName)?.cells.find((candidate) => candidate.address === address);
  if (!cell) throw new Error(`Missing ${sheetName}!${address}`);
  cell.value = value;
}

function resultIds(workbook: ParsedWorkbook, status: "passed" | "failed" | "cannot-verify" | "not-applicable"): string[] {
  return [...new Set(runFinancialAudit(workbook).checks.filter((check) => check.status === status).map((check) => check.ruleId))];
}

describe("ModelGuard financial audit contract", () => {
  it("passes every finance rule on the clean golden workbook", async () => {
    const passed = new Set(resultIds(await parse("modelguard-clean-model.xlsx"), "passed"));
    expect(RULE_IDS.every((ruleId) => passed.has(ruleId))).toBe(true);
  });

  it("keeps missing mappings unavailable instead of treating them as zero", () => {
    const empty: ParsedWorkbook = {
      schemaVersion: "1.0", fileName: "empty.xlsx", fileSizeBytes: 0, sha256: "0", parsedAt: "2026-08-10T00:00:00.000Z",
      provenance: { sourceType: "user-local", provider: "browser", generatedAt: "2026-08-10T00:00:00.000Z", disclaimer: "local" },
      sheets: [], definedNames: [], externalLinks: [], warnings: [], stats: { nonEmptyCells: 0, formulas: 0, worksheets: 0, parseMilliseconds: 0 },
    };
    const unavailable = new Set([...resultIds(empty, "cannot-verify"), ...resultIds(empty, "not-applicable")]);
    expect(RULE_IDS.every((ruleId) => unavailable.has(ruleId))).toBe(true);
  });

  it("detects the seeded cross-statement and DCF defects", async () => {
    const report = runFinancialAudit(await parse("modelguard-error-model.xlsx"));
    const failed = new Set(report.issues.map((issue) => issue.ruleId));
    expect([...failed]).toEqual(expect.arrayContaining(["MG-ACC-001", "MG-ACC-003", "MG-ACC-004", "MG-ACC-005", "MG-DCF-001", "MG-DCF-002", "MG-DCF-003", "MG-DCF-004", "MG-DCF-006", "MG-DCF-007", "MG-DCF-008", "MG-DCF-009", "MG-DCF-010", "MG-SCN-001", "MG-ASM-001", "MG-ASM-002", "MG-ASM-003", "MG-ASM-004", "MG-ASM-006"]));
    expect(report.checks.some((check) => check.ruleId === "MG-SCN-005" && check.status === "cannot-verify")).toBe(true);
  });

  it("covers targeted failure paths for rules that require distinct fixtures", async () => {
    const clean = await parse("modelguard-clean-model.xlsx");
    const cashBreak = clone(clean); cached(cashBreak, "Cash Flow", "C7", 999);
    expect(resultIds(cashBreak, "failed")).toContain("MG-ACC-002");

    const terminalFormula = clone(clean); cached(terminalFormula, "DCF", "B8", 3326);
    expect(resultIds(terminalFormula, "failed")).toContain("MG-DCF-005");

    const scenarioOrdering = clone(clean); raw(scenarioOrdering, "Scenarios", "B5", 0.1); raw(scenarioOrdering, "Scenarios", "D5", 0.06);
    expect(resultIds(scenarioOrdering, "failed")).toContain("MG-SCN-002");

    const scenarioOutput = clone(clean); cached(scenarioOutput, "Scenarios", "B9", 30); cached(scenarioOutput, "Scenarios", "D9", 18);
    expect(resultIds(scenarioOutput, "failed")).toContain("MG-SCN-003");

    const scenarioDisconnected = clone(clean); raw(scenarioDisconnected, "Scenarios", "B5", 0.03); raw(scenarioDisconnected, "Scenarios", "D5", 0.12); cached(scenarioDisconnected, "Scenarios", "B9", 22.87); cached(scenarioDisconnected, "Scenarios", "D9", 22.87);
    expect(resultIds(scenarioDisconnected, "failed")).toContain("MG-SCN-004");

    const marginJump = clone(clean); cached(marginJump, "Income Statement", "C6", 500);
    expect(resultIds(marginJump, "failed")).toContain("MG-ASM-005");

    const negativeFcff = clone(clean); cached(negativeFcff, "DCF", "F5", -1);
    expect(resultIds(negativeFcff, "failed")).toContain("MG-DCF-011");

    const concentration = clone(clean); cached(concentration, "DCF", "B10", 2400);
    expect(resultIds(concentration, "failed")).toContain("MG-DCF-010");
  });

  it("uses a strict tolerance boundary", async () => {
    const clean = await parse("modelguard-clean-model.xlsx");
    const atBoundary = clone(clean); cached(atBoundary, "Balance Sheet", "C7", 310.1);
    expect(resultIds(atBoundary, "failed")).not.toContain("MG-ACC-001");
    const beyondBoundary = clone(clean); cached(beyondBoundary, "Balance Sheet", "C7", 310.101);
    expect(resultIds(beyondBoundary, "failed")).toContain("MG-ACC-001");
  });
});
