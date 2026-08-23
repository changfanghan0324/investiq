import type { AuditCategory, AuditSeverity } from "@/domain/modelguard-audit";

export interface RuleCatalogEntry {
  ruleId: string;
  name: string;
  nameZh?: string;
  category: AuditCategory;
  severity: AuditSeverity;
  checkObject: string;
  logic: string;
  observed: string;
  expected: string;
  tolerance: string;
  scope: string;
  notApplicable: string;
  falsePositive: string;
  falseNegative: string;
  remediation: string;
  pseudoCode: string;
  exampleInput: string;
  exampleOutput: string;
  ruleVersion: string;
  implemented: boolean;
}

const ZH_RULE_NAMES: Record<string, string> = {
  "MG-STR-001": "公式错误标记", "MG-STR-002": "公式缺少缓存值", "MG-STR-003": "引用了不存在的工作表", "MG-STR-004": "引用了空单元格", "MG-STR-005": "未跟随外部链接", "MG-STR-006": "隐藏工作表复核", "MG-STR-007": "隐藏行或列复核", "MG-STR-008": "合并单元格复核", "MG-STR-009": "命名区域复核", "MG-STR-010": "循环引用风险", "MG-STR-011": "公式覆盖范围缺口",
  "MG-ACC-001": "资产负债表勾稽", "MG-ACC-002": "现金勾稽", "MG-ACC-003": "留存收益桥接", "MG-ACC-004": "债务计划勾稽", "MG-ACC-005": "稀释后股数",
  "MG-DCF-001": "WACC 高于终值增长率", "MG-DCF-002": "FCFF 勾稽", "MG-DCF-003": "折现因子序列", "MG-DCF-004": "FCFF 现值勾稽", "MG-DCF-005": "终值公式", "MG-DCF-006": "终值现值", "MG-DCF-007": "企业价值桥接", "MG-DCF-008": "股权价值桥接", "MG-DCF-009": "隐含每股价值", "MG-DCF-010": "终值集中度", "MG-DCF-011": "终值年份 FCFF",
  "MG-SCN-001": "情景假设存在差异", "MG-SCN-002": "情景排序", "MG-SCN-003": "情景输出排序", "MG-SCN-004": "情景输出连接", "MG-SCN-005": "情景公式结构",
  "MG-ASM-001": "假设来源", "MG-ASM-002": "假设负责人", "MG-ASM-003": "分析师估值假设", "MG-ASM-004": "预测期阶跃变化", "MG-ASM-005": "预测期利润率跳变", "MG-ASM-006": "预测期硬编码",
};

const base = (entry: Omit<RuleCatalogEntry, "tolerance" | "scope" | "notApplicable" | "falsePositive" | "falseNegative" | "remediation" | "pseudoCode" | "exampleInput" | "exampleOutput" | "ruleVersion" | "implemented">): RuleCatalogEntry => ({
  ...entry,
  nameZh: ZH_RULE_NAMES[entry.ruleId],
  tolerance: "Configured finance tolerance (default 0.1) where numeric reconciliation applies.",
  scope: "Mapped cells and period headers in the uploaded workbook.",
  notApplicable: "Required sheet, label, period, or mapping is absent; reported as Not applicable or Could not verify.",
  falsePositive: "A documented exception or non-standard model convention may make this signal intentional.",
  falseNegative: "ModelGuard does not recalculate Excel, execute macros, or infer undocumented business meaning.",
  remediation: "Review the cited cell and source, correct or document the assumption, then rerun the audit.",
  pseudoCode: "Observe mapped evidence → calculate the expected condition → compare the difference with tolerance → report pass, finding, not applicable, or cannot verify.",
  exampleInput: "Mapped worksheet cells, formulas, cached values, and period headers.",
  exampleOutput: "A cell-level finding with observed value, expected condition, and review status.",
  ruleVersion: "1.0",
  implemented: true,
});

export const MODEL_GUARD_RULE_CATALOG: RuleCatalogEntry[] = [
  base({ ruleId: "MG-STR-001", name: "Formula error token", category: "formula", severity: "critical", checkObject: "Formula text and cached result", logic: "Search formula and cached result for Excel error tokens.", observed: "Formula or cached value", expected: "No #REF!, #DIV/0!, #VALUE!, #NAME?, #N/A, #NUM!, or #NULL! token" }),
  base({ ruleId: "MG-STR-002", name: "Missing formula cache", category: "formula", severity: "medium", checkObject: "Formula cached value", logic: "Detect formulas without a stored result.", observed: "Formula text", expected: "A cached value saved by Excel" }),
  base({ ruleId: "MG-STR-003", name: "Missing worksheet reference", category: "linkage", severity: "critical", checkObject: "Cross-sheet formula references", logic: "Resolve referenced worksheet names against parsed sheets.", observed: "Referenced sheet name", expected: "An existing worksheet" }),
  base({ ruleId: "MG-STR-004", name: "Empty cell reference", category: "linkage", severity: "critical", checkObject: "A1 references", logic: "Resolve local cell references and check for a parsed value or formula.", observed: "Referenced sheet and cell", expected: "A populated source cell" }),
  base({ ruleId: "MG-STR-005", name: "External link not followed", category: "structure", severity: "medium", checkObject: "External workbook metadata", logic: "Report external relationships without opening them.", observed: "External target or formula", expected: "Reviewed local source or no external link" }),
  base({ ruleId: "MG-STR-006", name: "Hidden worksheet review", category: "structure", severity: "info", checkObject: "Worksheet visibility", logic: "Surface hidden and very hidden sheets.", observed: "Sheet state", expected: "Explicit reviewer acknowledgement" }),
  base({ ruleId: "MG-STR-007", name: "Hidden row or column review", category: "structure", severity: "info", checkObject: "Row and column visibility", logic: "Surface hidden rows and columns captured from the workbook.", observed: "Hidden row/column addresses", expected: "Explicit reviewer acknowledgement" }),
  base({ ruleId: "MG-STR-008", name: "Merged cell review", category: "structure", severity: "info", checkObject: "Merged ranges", logic: "Surface merged ranges that can obscure input or formula coverage.", observed: "Merged range", expected: "Reviewed presentation-only merge" }),
  base({ ruleId: "MG-STR-009", name: "Defined name review", category: "structure", severity: "info", checkObject: "Named ranges", logic: "Surface defined names for reviewer traceability.", observed: "Name and range", expected: "Reviewed and intentionally scoped name" }),
  base({ ruleId: "MG-STR-010", name: "Circular reference risk", category: "formula", severity: "warning", checkObject: "Formula references", logic: "Detect direct self references and simple same-cell cycles without recalculating Excel.", observed: "Formula reference", expected: "No direct circular reference" }),
  base({ ruleId: "MG-STR-011", name: "Formula coverage gap", category: "formula", severity: "medium", checkObject: "Formula rows across periods", logic: "Detect a value or blank between formula cells in the same mapped row.", observed: "Row formula pattern", expected: "Consistent formula coverage or documented input" }),
  base({ ruleId: "MG-ACC-001", name: "Balance sheet reconciliation", category: "accounting", severity: "critical", checkObject: "Assets, liabilities, and equity", logic: "Assets − liabilities − equity by mapped period.", observed: "Three mapped values and difference", expected: "Difference within configured tolerance" }),
  base({ ruleId: "MG-ACC-002", name: "Cash reconciliation", category: "accounting", severity: "high", checkObject: "Beginning cash, net change, ending cash", logic: "Beginning cash + net change − ending cash.", observed: "Three mapped values and difference", expected: "Difference within configured tolerance" }),
  base({ ruleId: "MG-ACC-003", name: "Retained earnings bridge", category: "accounting", severity: "high", checkObject: "Retained earnings bridge", logic: "Beginning retained earnings + net income − dividends + adjustments − ending retained earnings.", observed: "Mapped bridge values and difference", expected: "Difference within configured tolerance" }),
  base({ ruleId: "MG-ACC-004", name: "Debt schedule reconciliation", category: "accounting", severity: "high", checkObject: "Debt schedule and balance sheet", logic: "Current debt + long-term debt = schedule total = balance-sheet debt.", observed: "Mapped debt values and differences", expected: "Arithmetic and mapped debt within tolerance" }),
  base({ ruleId: "MG-ACC-005", name: "Diluted share count", category: "accounting", severity: "high", checkObject: "DCF shares and input shares", logic: "Compare DCF diluted shares with mapped input share count.", observed: "Two share counts and difference", expected: "Difference within configured tolerance" }),
  base({ ruleId: "MG-DCF-001", name: "WACC above terminal growth", category: "dcf", severity: "critical", checkObject: "WACC and terminal growth", logic: "Require WACC > terminal growth for Gordon growth denominator.", observed: "WACC and terminal growth", expected: "Terminal growth less than WACC" }),
  base({ ruleId: "MG-DCF-002", name: "FCFF reconciliation", category: "dcf", severity: "high", checkObject: "EBIT, tax, D&A, CapEx, NWC, FCFF", logic: "Compare mapped FCFF with EBIT after cash tax + D&A − CapEx − change in NWC.", observed: "Observed and calculated FCFF", expected: "Difference within configured tolerance" }),
  base({ ruleId: "MG-DCF-003", name: "Discount factor sequence", category: "dcf", severity: "high", checkObject: "Discount factors", logic: "Require conventional end-year factors to decline across periods.", observed: "Factor sequence", expected: "Strictly declining sequence" }),
  base({ ruleId: "MG-DCF-004", name: "PV FCFF reconciliation", category: "dcf", severity: "high", checkObject: "FCFF, discount factor, PV FCFF", logic: "FCFF × discount factor = PV FCFF.", observed: "Observed and calculated PV", expected: "Difference within configured tolerance" }),
  base({ ruleId: "MG-DCF-005", name: "Terminal value formula", category: "dcf", severity: "high", checkObject: "Final FCFF, growth, WACC, terminal value", logic: "Apply Gordon growth when the denominator is valid.", observed: "Observed and calculated terminal value", expected: "Difference within configured tolerance" }),
  base({ ruleId: "MG-DCF-006", name: "PV terminal value", category: "dcf", severity: "high", checkObject: "Terminal value and discount factor", logic: "Terminal value × terminal discount factor = PV terminal value.", observed: "Observed and calculated PV", expected: "Difference within configured tolerance" }),
  base({ ruleId: "MG-DCF-007", name: "Enterprise value bridge", category: "dcf", severity: "high", checkObject: "PV FCFF, PV terminal value, enterprise value", logic: "Sum forecast PVs and PV terminal value.", observed: "Observed and calculated enterprise value", expected: "Difference within configured tolerance" }),
  base({ ruleId: "MG-DCF-008", name: "Equity value bridge", category: "dcf", severity: "high", checkObject: "Enterprise value, net debt, adjustments", logic: "Enterprise value − net debt + explicit equity adjustments.", observed: "Observed and calculated equity value", expected: "Difference within configured tolerance" }),
  base({ ruleId: "MG-DCF-009", name: "Implied share value", category: "dcf", severity: "high", checkObject: "Equity value and diluted shares", logic: "Equity value ÷ positive diluted shares.", observed: "Observed and calculated implied value", expected: "Difference within configured tolerance" }),
  base({ ruleId: "MG-DCF-010", name: "Terminal value concentration", category: "dcf", severity: "medium", checkObject: "PV terminal value / enterprise value", logic: "Flag high review risk above the configured threshold; not a universal error.", observed: "Concentration ratio", expected: "At or below configured review threshold" }),
  base({ ruleId: "MG-DCF-011", name: "Terminal-year FCFF", category: "dcf", severity: "medium", checkObject: "Final forecast FCFF", logic: "Flag a non-positive terminal-year FCFF as a review signal.", observed: "Terminal-year FCFF", expected: "> 0 for conventional positive-growth case" }),
  base({ ruleId: "MG-SCN-001", name: "Scenario assumptions differ", category: "scenario", severity: "high", checkObject: "Bear/Base/Bull assumptions", logic: "Detect identical core assumptions across scenarios.", observed: "Scenario assumption values", expected: "Distinct or explicitly documented scenarios" }),
  base({ ruleId: "MG-SCN-002", name: "Scenario ordering", category: "scenario", severity: "medium", checkObject: "Bear/Base/Bull assumptions", logic: "Apply documented growth, margin, and WACC ordering heuristic.", observed: "Three scenario values", expected: "Bear ≤ Base ≤ Bull where applicable" }),
  base({ ruleId: "MG-SCN-003", name: "Scenario output ordering", category: "scenario", severity: "high", checkObject: "Scenario output", logic: "Review output ordering against Bear ≤ Base ≤ Bull.", observed: "Scenario outputs", expected: "Bear no greater than Base, Base no greater than Bull" }),
  base({ ruleId: "MG-SCN-004", name: "Scenario output connection", category: "scenario", severity: "high", checkObject: "Scenario assumptions and output", logic: "Detect materially different assumptions with unchanged mapped output.", observed: "Assumption delta and output delta", expected: "Output responds or exception is documented" }),
  base({ ruleId: "MG-SCN-005", name: "Scenario formula structure", category: "scenario", severity: "medium", checkObject: "Scenario formulas", logic: "Require normalized scenario formulas when scenario sheet exists.", observed: "Formula cells", expected: "Inspectable formula structure" }),
  base({ ruleId: "MG-ASM-001", name: "Assumption source", category: "assumption", severity: "medium", checkObject: "Source / basis column", logic: "Find important assumptions without source or basis.", observed: "Source field", expected: "Documented source or basis" }),
  base({ ruleId: "MG-ASM-002", name: "Assumption owner", category: "assumption", severity: "medium", checkObject: "Owner column", logic: "Find important assumptions without an owner.", observed: "Owner field", expected: "Named owner" }),
  base({ ruleId: "MG-ASM-003", name: "Analyst-owned valuation assumptions", category: "assumption", severity: "medium", checkObject: "WACC and terminal growth metadata", logic: "Require ownership or basis to be explicit.", observed: "Metadata fields", expected: "Explicit analyst assumption marker" }),
  base({ ruleId: "MG-ASM-004", name: "Forecast step change", category: "assumption", severity: "medium", checkObject: "Historical and first forecast revenue", logic: "Flag abrupt first forecast revenue step above policy threshold.", observed: "Historical → forecast values", expected: "Step within configured threshold" }),
  base({ ruleId: "MG-ASM-005", name: "Forecast margin jump", category: "assumption", severity: "medium", checkObject: "Historical and first forecast margin", logic: "Flag abrupt first forecast margin change above policy threshold.", observed: "Historical → forecast margins", expected: "Change within configured threshold" }),
  base({ ruleId: "MG-ASM-006", name: "Forecast hardcode", category: "assumption", severity: "medium", checkObject: "Forecast-period Income Statement cells", logic: "Flag numeric forecast values that are not formulas; historical values and explicit assumptions are not automatically errors.", observed: "Forecast cell value", expected: "Formula or documented assumption" }),
];

export function ruleCatalogEntry(ruleId: string): RuleCatalogEntry | undefined {
  return MODEL_GUARD_RULE_CATALOG.find((entry) => entry.ruleId === ruleId);
}
