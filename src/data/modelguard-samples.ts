export interface ModelGuardSampleDefinition {
  id: string;
  fileName: string;
  title: string;
  description: string;
  expectedRuleIds: string[];
  purpose: string;
  downloadPath: string;
  containsFormulas: boolean;
  intentionallyBroken: boolean;
}

export const MODEL_GUARD_SAMPLE_DEFINITIONS: ModelGuardSampleDefinition[] = [
  { id: "clean", fileName: "modelguard-clean-model.xlsx", title: "Clean Model", description: "A balanced three-statement and DCF workbook with documented assumptions.", expectedRuleIds: [], purpose: "Baseline: no deterministic findings expected.", downloadPath: "/samples/modelguard-clean-model.xlsx", containsFormulas: true, intentionallyBroken: false },
  { id: "error", fileName: "modelguard-error-model.xlsx", title: "Error Sample Model", description: "A deliberately flawed model covering accounting, DCF, structure, assumptions, and scenario checks.", expectedRuleIds: ["MG-ACC-001", "MG-ACC-002", "MG-ACC-003", "MG-ACC-004", "MG-ACC-005", "MG-ASM-001", "MG-ASM-002", "MG-ASM-003", "MG-ASM-004", "MG-ASM-006", "MG-DCF-001", "MG-DCF-002", "MG-DCF-003", "MG-DCF-004", "MG-DCF-006", "MG-DCF-007", "MG-DCF-008", "MG-DCF-009", "MG-DCF-010", "MG-SCN-001", "MG-SCN-005", "MG-STR-001", "MG-STR-002", "MG-STR-003", "MG-STR-004", "MG-STR-005", "MG-STR-006"], purpose: "Golden error fixture: expected findings are intentionally visible for rule validation.", downloadPath: "/samples/modelguard-error-model.xlsx", containsFormulas: true, intentionallyBroken: true },
  { id: "balance-sheet-error", fileName: "modelguard-balance-sheet-error.xlsx", title: "Balance Sheet Error", description: "A workbook with an intentionally unbalanced balance sheet.", expectedRuleIds: ["MG-ACC-001"], purpose: "Validate balance-sheet reconciliation and tolerance evidence.", downloadPath: "/samples/modelguard-balance-sheet-error.xlsx", containsFormulas: true, intentionallyBroken: true },
  { id: "dcf-error", fileName: "modelguard-dcf-error.xlsx", title: "DCF Error", description: "A workbook with an invalid WACC / terminal-growth relationship.", expectedRuleIds: ["MG-DCF-001"], purpose: "Validate DCF denominator and terminal value controls.", downloadPath: "/samples/modelguard-dcf-error.xlsx", containsFormulas: true, intentionallyBroken: true },
  { id: "hardcode-error", fileName: "modelguard-hardcode-error.xlsx", title: "Hardcode Error", description: "A forecast-period value is intentionally entered as a hardcode.", expectedRuleIds: ["MG-ASM-004", "MG-ASM-006"], purpose: "Validate the distinction between historical values and forecast hardcodes.", downloadPath: "/samples/modelguard-hardcode-error.xlsx", containsFormulas: true, intentionallyBroken: true },
  { id: "scenario-error", fileName: "modelguard-scenario-error.xlsx", title: "Scenario Error", description: "Core scenario assumptions change while the mapped output remains unchanged.", expectedRuleIds: ["MG-SCN-004"], purpose: "Validate scenario propagation and disconnected output detection.", downloadPath: "/samples/modelguard-scenario-error.xlsx", containsFormulas: true, intentionallyBroken: true },
  { id: "version-before", fileName: "modelguard-version-1.xlsx", title: "Version Before", description: "The first version of the version-comparison sample.", expectedRuleIds: ["MG-ASM-001", "MG-ASM-006", "MG-DCF-001"], purpose: "Baseline for resolved findings.", downloadPath: "/samples/modelguard-version-1.xlsx", containsFormulas: true, intentionallyBroken: true },
  { id: "version-after", fileName: "modelguard-version-2.xlsx", title: "Version After", description: "The second version resolves three findings and introduces one scenario issue.", expectedRuleIds: ["MG-SCN-004"], purpose: "Expected comparison: Resolved 3, Persisting 0, New 1.", downloadPath: "/samples/modelguard-version-2.xlsx", containsFormulas: true, intentionallyBroken: true },
  { id: "audit-report", fileName: "modelguard-sample-audit-report.json", title: "Sample Audit Report", description: "A generated receipt from the error sample, including provenance and limitations.", expectedRuleIds: ["MG-ACC-001", "MG-DCF-001"], purpose: "Inspect the local JSON audit receipt shape.", downloadPath: "/samples/modelguard-sample-audit-report.json", containsFormulas: false, intentionallyBroken: false },
];

export function sampleDefinition(fileName: string | null | undefined): ModelGuardSampleDefinition | undefined {
  return MODEL_GUARD_SAMPLE_DEFINITIONS.find((sample) => sample.fileName === fileName);
}
