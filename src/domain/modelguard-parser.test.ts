import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { WORKBOOK_LIMITS, assertWorkbookSize } from "@/domain/modelguard-limits";
import { workbookParser } from "@/services/modelguard-parser";

describe("ModelGuard workbook parser contract", () => {
  it("normalizes a local sample without following external data", async () => {
    const buffer = await readFile("public/samples/modelguard-clean-model.xlsx");
    const parsed = await workbookParser.parse(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength), { fileName: "modelguard-clean-model.xlsx" });
    expect(parsed.schemaVersion).toBe("1.0");
    expect(parsed.provenance.sourceType).toBe("user-local");
    expect(parsed.sheets.map((sheet) => sheet.name)).toContain("DCF");
    expect(parsed.stats.formulas).toBeGreaterThan(5);
    expect(parsed.definedNames.map((name) => name.name)).toContain("WACC");
    expect(parsed.externalLinks).toEqual([]);
    expect(parsed.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("preserves hidden sheets and detects deterministic warnings", async () => {
    const buffer = await readFile("public/samples/modelguard-error-model.xlsx");
    const parsed = await workbookParser.parse(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength), { fileName: "modelguard-error-model.xlsx" });
    expect(parsed.sheets.find((sheet) => sheet.name === "Hidden Checks")?.state).toBe("hidden");
    expect(parsed.sheets.flatMap((sheet) => sheet.cells).some((cell) => cell.kind === "formula")).toBe(true);
  });

  it("rejects a workbook that exceeds the central byte limit", () => {
    expect(() => assertWorkbookSize(WORKBOOK_LIMITS.maxFileBytes + 1)).toThrow(/limit/);
  });
});
