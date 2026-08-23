import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { auditWorkbook } from "@/domain/modelguard-audit";
import { MODEL_GUARD_SAMPLE_DEFINITIONS } from "@/data/modelguard-samples";
import { workbookParser } from "@/services/modelguard-parser";

async function auditSample(fileName: string) {
  const bytes = await readFile(`public/samples/${fileName}`);
  const input = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return auditWorkbook(await workbookParser.parse(input, { fileName }));
}

describe("ModelGuard published sample workbooks", () => {
  it("matches every sample's published expected findings", async () => {
    for (const sample of MODEL_GUARD_SAMPLE_DEFINITIONS.filter((entry) => entry.id !== "audit-report")) {
      const report = await auditSample(sample.fileName);
      const actual = [...new Set(report.issues.map((issue) => issue.ruleId))].sort();
      expect(actual, sample.fileName).toEqual([...sample.expectedRuleIds].sort());
    }
  });

  it("keeps the clean sample explicitly clean without implying certification", async () => {
    const report = await auditSample("modelguard-clean-model.xlsx");
    expect(report.issues).toEqual([]);
    expect(report.limitations?.join(" ")).toContain("does not recalculate");
    expect(report.modelStatus).toBe("Ready for review");
  });
});
