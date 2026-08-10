import { addIssue, type AuditCategory, type AuditCheck, type AuditIssue } from "@/domain/modelguard-audit";
import type { CellRecord, ParsedSheet, ParsedWorkbook } from "@/domain/modelguard-schema";

export interface FinanceAuditPolicy {
  tolerance: number;
  terminalValueConcentrationWarning: number;
  abruptForecastStep: number;
  forecastMarginJump: number;
  scenarioMaterialChange: number;
}

export const DEFAULT_FINANCE_AUDIT_POLICY: FinanceAuditPolicy = {
  tolerance: 0.1,
  terminalValueConcentrationWarning: 0.8,
  abruptForecastStep: 0.2,
  forecastMarginJump: 0.1,
  scenarioMaterialChange: 0.02,
};

type PeriodMap = Map<string, number>;
type Located = { sheet: ParsedSheet; cell: CellRecord; row: number; label: string };

function valueOf(cell: CellRecord | undefined): number | null {
  const value = cell?.kind === "formula" ? cell.cachedValue : cell?.value;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function sheetNamed(workbook: ParsedWorkbook, pattern: RegExp): ParsedSheet | undefined { return workbook.sheets.find((sheet) => pattern.test(sheet.name)); }

function periods(sheet: ParsedSheet): PeriodMap {
  const result: PeriodMap = new Map();
  for (const cell of sheet.cells) if (/^(?:FY)?20\d{2}[AEF]?$/i.test(String(cell.value ?? ""))) result.set(String(cell.value), cell.column);
  return result;
}

function locate(sheet: ParsedSheet | undefined, pattern: RegExp): Located | undefined {
  if (!sheet) return undefined;
  const cell = sheet.cells.find((candidate) => candidate.column === 1 && pattern.test(String(candidate.value ?? "")));
  return cell ? { sheet, cell, row: cell.row, label: String(cell.value) } : undefined;
}

function at(sheet: ParsedSheet, row: number, column: number): CellRecord | undefined { return sheet.cells.find((cell) => cell.row === row && cell.column === column); }

function check(checks: AuditCheck[], ruleId: string, category: AuditCategory, status: AuditCheck["status"], severity?: AuditCheck["severity"], located?: Located, period?: string): void {
  checks.push({ ruleId, category, status, severity, sheet: located?.sheet.name, address: located?.cell.address, period });
}

function fail(issues: AuditIssue[], checks: AuditCheck[], ruleId: string, category: AuditCategory, severity: AuditIssue["severity"], title: string, message: string, located?: Located, extra: Partial<AuditIssue> = {}): void {
  check(checks, ruleId, category, "failed", severity, located, extra.period);
  addIssue(issues, { ruleId, category, severity, title, message, sheet: located?.sheet.name, address: located?.cell.address, ...extra });
}

function cannot(issues: AuditIssue[], checks: AuditCheck[], ruleId: string, category: AuditCategory, title: string, message: string, located?: Located, extra: Partial<AuditIssue> = {}): void {
  check(checks, ruleId, category, "cannot-verify", "medium", located, extra.period);
  addIssue(issues, { ruleId, category, severity: "medium", status: "cannot-verify", title, message, sheet: located?.sheet.name, address: located?.cell.address, ...extra });
}

function pass(checks: AuditCheck[], ruleId: string, category: AuditCategory, located?: Located, period?: string): void { check(checks, ruleId, category, "passed", undefined, located, period); }
function notApplicable(checks: AuditCheck[], ruleId: string, category: AuditCategory): void { check(checks, ruleId, category, "not-applicable"); }
function exceedsTolerance(difference: number, tolerance: number): boolean { return Math.abs(difference) > tolerance + 1e-9; }

function comparePeriods(issues: AuditIssue[], checks: AuditCheck[], ruleId: string, category: AuditCategory, severity: AuditIssue["severity"], title: string, message: string, sheet: ParsedSheet | undefined, labels: RegExp[], equation: (values: number[]) => number, policy: FinanceAuditPolicy): void {
  const periodMap = periods(sheet ?? ({ cells: [], name: "", state: "visible", mergedRanges: [] } as ParsedSheet));
  if (!sheet || periodMap.size === 0) { cannot(issues, checks, ruleId, category, title, "Required period headers or mappings are missing; ModelGuard cannot verify this control."); return; }
  let any = false;
  for (const [period, column] of periodMap) {
    const locatedRows = labels.map((label) => locate(sheet, label));
    const values = locatedRows.map((row) => row ? valueOf(at(sheet, row.row, column)) : null);
    if (values.some((value) => value === null)) { cannot(issues, checks, ruleId, category, title, `Required mapping is missing for ${period}; missing data is not treated as zero.`, locatedRows.find(Boolean), { period }); any = true; continue; }
    const numericValues = values as number[];
    const difference = equation(numericValues);
    if (exceedsTolerance(difference, policy.tolerance)) { fail(issues, checks, ruleId, category, severity, title, message, locatedRows[0] ?? undefined, { period, observed: numericValues.map((value) => value.toFixed(3)).join(" / "), difference: difference.toFixed(3), tolerance: policy.tolerance.toFixed(3), expected: "Difference within configured tolerance" }); any = true; } else pass(checks, ruleId, category, locatedRows[0] ?? undefined, period);
  }
  if (!any && periodMap.size === 0) cannot(issues, checks, ruleId, category, title, "Cannot verify without period data.");
}

function accountingAudit(workbook: ParsedWorkbook, issues: AuditIssue[], checks: AuditCheck[], policy: FinanceAuditPolicy): void {
  const balance = sheetNamed(workbook, /balance sheet/i);
  comparePeriods(issues, checks, "MG-ACC-001", "accounting", "critical", "Balance sheet does not balance", "Assets must equal liabilities plus equity. Review the exact period cells and the observed difference.", balance, [/^assets$/i, /^liabilities$/i, /^equity$/i], ([assets, liabilities, equity]) => assets - liabilities - equity, policy);
  const cash = sheetNamed(workbook, /cash flow/i);
  comparePeriods(issues, checks, "MG-ACC-002", "accounting", "high", "Cash reconciliation does not tie", "Beginning cash plus net change in cash must equal ending cash.", cash, [/beginning cash/i, /net change.*cash/i, /ending cash/i], ([beginning, change, ending]) => beginning + change - ending, policy);
  comparePeriods(issues, checks, "MG-ACC-003", "accounting", "high", "Retained earnings bridge does not tie", "Beginning retained earnings plus net income less dividends plus defined adjustments must equal ending retained earnings. Missing dividends are not assumed to be zero.", balance, [/beginning retained earnings/i, /net income/i, /dividends/i, /defined adjustments/i, /ending retained earnings/i], ([beginning, income, dividends, adjustments, ending]) => beginning + income - dividends + adjustments - ending, policy);
  const debtSchedule = sheetNamed(workbook, /debt schedule/i);
  if (!debtSchedule) notApplicable(checks, "MG-ACC-004", "accounting");
  else {
    const debtPeriods = periods(debtSchedule);
    const balancePeriods = periods(balance ?? ({ cells: [], name: "", state: "visible", mergedRanges: [] } as ParsedSheet));
    const current = locate(debtSchedule, /current debt/i);
    const longTerm = locate(debtSchedule, /long[- ]term debt/i);
    const total = locate(debtSchedule, /^total debt$/i);
    const balanceTotal = locate(balance, /^total debt$/i);
    if (!balance || debtPeriods.size === 0 || !current || !longTerm || !total || !balanceTotal) {
      cannot(issues, checks, "MG-ACC-004", "accounting", "Debt schedule reconciliation cannot be verified", "Current debt, long-term debt, total debt, balance-sheet debt, or period mapping is incomplete.", total ?? balanceTotal ?? current);
    } else {
      for (const [period, column] of debtPeriods) {
        const balanceColumn = balancePeriods.get(period);
        const values = [valueOf(at(debtSchedule, current.row, column)), valueOf(at(debtSchedule, longTerm.row, column)), valueOf(at(debtSchedule, total.row, column)), balanceColumn ? valueOf(at(balance, balanceTotal.row, balanceColumn)) : null];
        if (values.some((value) => value === null)) {
          cannot(issues, checks, "MG-ACC-004", "accounting", "Debt schedule reconciliation cannot be verified", `Debt schedule or balance-sheet debt mapping is incomplete for ${period}; missing data is not treated as zero.`, total, { period });
          continue;
        }
        const [currentValue, longTermValue, totalValue, balanceTotalValue] = values as number[];
        const scheduleDifference = currentValue + longTermValue - totalValue;
        const mappedDifference = totalValue - balanceTotalValue;
        if (exceedsTolerance(scheduleDifference, policy.tolerance) || exceedsTolerance(mappedDifference, policy.tolerance)) {
          fail(issues, checks, "MG-ACC-004", "accounting", "high", "Debt schedule does not reconcile", "Current debt plus long-term debt must equal schedule total debt, and schedule total debt must reconcile to mapped balance-sheet debt.", total, { period, observed: `${currentValue.toFixed(3)} / ${longTermValue.toFixed(3)} / ${totalValue.toFixed(3)} / ${balanceTotalValue.toFixed(3)}`, expected: "Schedule arithmetic and balance-sheet debt within tolerance", difference: `${scheduleDifference.toFixed(3)} / ${mappedDifference.toFixed(3)}`, tolerance: policy.tolerance.toFixed(3) });
        } else pass(checks, "MG-ACC-004", "accounting", total, period);
      }
    }
  }
  const dcf = sheetNamed(workbook, /^dcf$/i); const inputs = sheetNamed(workbook, /^inputs?$/i);
  const dcfShares = locate(dcf, /diluted shares/i); const inputShares = locate(inputs, /diluted shares/i);
  const dcfValue = dcfShares ? valueOf(at(dcfShares.sheet, dcfShares.row, dcfShares.cell.column + 1)) : null;
  const inputValue = inputShares ? valueOf(at(inputShares.sheet, inputShares.row, inputShares.cell.column + 1)) : null;
  if (dcfShares && inputShares && dcfValue !== null && inputValue !== null && Math.abs(dcfValue - inputValue) > policy.tolerance) fail(issues, checks, "MG-ACC-005", "accounting", "high", "Diluted share count does not reconcile", "The DCF diluted-shares denominator differs from the mapped diluted share count.", dcfShares, { observed: String(dcfValue), expected: String(inputValue), difference: (dcfValue - inputValue).toFixed(3), tolerance: policy.tolerance.toFixed(3) });
  else if (dcfShares && inputShares) pass(checks, "MG-ACC-005", "accounting", dcfShares);
  else cannot(issues, checks, "MG-ACC-005", "accounting", "Diluted share count cannot be verified", "The DCF or input diluted-share mapping is missing.", dcfShares ?? inputShares);
}

function dcfAudit(workbook: ParsedWorkbook, issues: AuditIssue[], checks: AuditCheck[], policy: FinanceAuditPolicy): void {
  const dcf = sheetNamed(workbook, /^dcf$/i); const inputs = sheetNamed(workbook, /^inputs?$/i); const income = sheetNamed(workbook, /income statement/i); const cash = sheetNamed(workbook, /cash flow/i);
  const dcfPeriods = periods(dcf ?? ({ cells: [], name: "", state: "visible", mergedRanges: [] } as ParsedSheet));
  const inputNumber = (pattern: RegExp): { value: number | null; located?: Located } => { const row = locate(inputs, pattern); const value = row ? valueOf(at(row.sheet, row.row, row.cell.column + 1)) : null; return { value, located: row }; };
  const wacc = inputNumber(/wacc/i); const growth = inputNumber(/terminal growth/i); const tax = inputNumber(/cash tax|tax rate/i);
  if (wacc.value !== null && growth.value !== null) { if (growth.value >= wacc.value) fail(issues, checks, "MG-DCF-001", "dcf", "critical", "Terminal growth is not below WACC", "The Gordon-growth denominator is zero or negative when terminal growth is at least the discount rate.", growth.located, { observed: String(growth.value), expected: `Less than WACC (${wacc.value})`, difference: (growth.value - wacc.value).toFixed(4), tolerance: "0" }); else pass(checks, "MG-DCF-001", "dcf", growth.located); } else cannot(issues, checks, "MG-DCF-001", "dcf", "WACC and terminal growth cannot be verified", "WACC or terminal-growth mapping is missing.", wacc.located ?? growth.located);
  const fcff = locate(dcf, /fcff/i); const ebit = locate(income, /^ebit$/i); const da = locate(cash, /d&a|depreciation/i); const capex = locate(cash, /capex|capital expenditure/i); const nwc = locate(cash, /change.*nwc|working capital/i);
  const incomePeriods = periods(income ?? ({ cells: [], name: "", state: "visible", mergedRanges: [] } as ParsedSheet));
  let fcffCheckable = false;
  for (const [period, column] of dcfPeriods) {
    const target = fcff ? valueOf(at(fcff.sheet, fcff.row, column)) : null; const sourceColumn = incomePeriods.get(period) ?? column;
    const components = [ebit ? valueOf(at(ebit.sheet, ebit.row, sourceColumn)) : null, tax.value, da ? valueOf(at(da.sheet, da.row, sourceColumn)) : null, capex ? valueOf(at(capex.sheet, capex.row, sourceColumn)) : null, nwc ? valueOf(at(nwc.sheet, nwc.row, sourceColumn)) : null];
    if (target === null || components.some((value) => value === null)) { cannot(issues, checks, "MG-DCF-002", "dcf", "FCFF cannot be verified", `FCFF components are incomplete for ${period}; ModelGuard does not infer missing values.`, fcff ?? ebit, { period }); continue; }
    const expected = (components[0] as number) * (1 - (components[1] as number)) + (components[2] as number) - (components[3] as number) - (components[4] as number); fcffCheckable = true;
    if (Math.abs(target - expected) > policy.tolerance) fail(issues, checks, "MG-DCF-002", "dcf", "high", "FCFF formula does not reconcile", "FCFF should equal EBIT after cash tax plus D&A less CapEx less change in NWC.", fcff ?? ebit, { period, observed: String(target), expected: String(expected), difference: (target - expected).toFixed(3), tolerance: policy.tolerance.toFixed(3) }); else pass(checks, "MG-DCF-002", "dcf", fcff ?? ebit, period);
  }
  if (!fcffCheckable && dcfPeriods.size === 0) cannot(issues, checks, "MG-DCF-002", "dcf", "FCFF cannot be verified", "DCF period mapping is missing.", fcff ?? ebit);
  const discount = locate(dcf, /discount factor/i); const pvFcff = locate(dcf, /pv.*fcff|present value.*fcff/i); const terminal = locate(dcf, /^terminal value$/i); const terminalDiscount = locate(dcf, /terminal discount/i); const pvTerminal = locate(dcf, /pv.*terminal|present value.*terminal/i); const ev = locate(dcf, /^enterprise value$/i); const netDebt = inputNumber(/net debt/i); const other = inputNumber(/other equity adjustments/i); const equity = locate(dcf, /^equity value$/i); const implied = locate(dcf, /implied share value/i);
  const discountValues: number[] = [];
  for (const [period, column] of dcfPeriods) { const discountValue = discount ? valueOf(at(discount.sheet, discount.row, column)) : null; if (discountValue !== null) discountValues.push(discountValue); const fcffValue = fcff ? valueOf(at(fcff.sheet, fcff.row, column)) : null; const pvValue = pvFcff ? valueOf(at(pvFcff.sheet, pvFcff.row, column)) : null; if (fcffValue !== null && discountValue !== null && pvValue !== null) { const expected = fcffValue * discountValue; if (exceedsTolerance(pvValue - expected, policy.tolerance)) fail(issues, checks, "MG-DCF-004", "dcf", "high", "Forecast FCFF present value does not reconcile", "PV FCFF should equal FCFF multiplied by the period discount factor.", pvFcff, { period, observed: String(pvValue), expected: String(expected), difference: (pvValue - expected).toFixed(3), tolerance: policy.tolerance.toFixed(3) }); else pass(checks, "MG-DCF-004", "dcf", pvFcff, period); } else cannot(issues, checks, "MG-DCF-004", "dcf", "Forecast FCFF present value cannot be verified", `FCFF, discount factor, or PV FCFF is missing for ${period}.`, pvFcff, { period }); }
  if (dcfPeriods.size === 0) cannot(issues, checks, "MG-DCF-004", "dcf", "Forecast FCFF present value cannot be verified", "DCF period mapping is missing.", pvFcff);
  if (discountValues.length > 1 && discountValues.some((value, index) => index > 0 && value >= discountValues[index - 1])) fail(issues, checks, "MG-DCF-003", "dcf", "high", "Discount factor sequence does not decline", "For a conventional end-year DCF, discount factors should decline as forecast periods move forward.", discount, { observed: discountValues.join(" → "), expected: "Strictly declining sequence" }); else if (discountValues.length > 1) pass(checks, "MG-DCF-003", "dcf", discount);
  else cannot(issues, checks, "MG-DCF-003", "dcf", "Discount factor sequence cannot be verified", "Fewer than two mapped discount factors are available.", discount);
  const finalColumn = dcfPeriods.size ? [...dcfPeriods.values()][dcfPeriods.size - 1] : null; const finalFcff = finalColumn && fcff ? valueOf(at(fcff.sheet, fcff.row, finalColumn)) : null; const terminalValue = terminal ? valueOf(at(terminal.sheet, terminal.row, terminal.cell.column + 1)) : null; const terminalPv = pvTerminal ? valueOf(at(pvTerminal.sheet, pvTerminal.row, pvTerminal.cell.column + 1)) : null; const terminalDiscountValue = terminalDiscount ? valueOf(at(terminalDiscount.sheet, terminalDiscount.row, terminalDiscount.cell.column + 1)) : null;
  if (finalFcff !== null && growth.value !== null && wacc.value !== null && terminalValue !== null && wacc.value > growth.value) { const expected = finalFcff * (1 + growth.value) / (wacc.value - growth.value); if (Math.abs(terminalValue - expected) > policy.tolerance) fail(issues, checks, "MG-DCF-005", "dcf", "high", "Terminal value formula does not reconcile", "Gordon-growth terminal value should use final forecast FCFF, terminal growth, and WACC.", terminal, { observed: String(terminalValue), expected: String(expected), difference: (terminalValue - expected).toFixed(3), tolerance: policy.tolerance.toFixed(3) }); else pass(checks, "MG-DCF-005", "dcf", terminal); } else cannot(issues, checks, "MG-DCF-005", "dcf", "Terminal value cannot be verified", "FCFF, WACC, terminal growth, or terminal-value mapping is incomplete.", terminal);
  if (terminalValue !== null && terminalDiscountValue !== null && terminalPv !== null) { const expected = terminalValue * terminalDiscountValue; if (Math.abs(terminalPv - expected) > policy.tolerance) fail(issues, checks, "MG-DCF-006", "dcf", "high", "Terminal value present value does not reconcile", "PV Terminal Value should equal terminal value multiplied by the terminal discount factor.", pvTerminal, { observed: String(terminalPv), expected: String(expected), difference: (terminalPv - expected).toFixed(3), tolerance: policy.tolerance.toFixed(3) }); else pass(checks, "MG-DCF-006", "dcf", pvTerminal); } else cannot(issues, checks, "MG-DCF-006", "dcf", "Terminal value present value cannot be verified", "Terminal value, terminal discount factor, or PV terminal mapping is incomplete.", pvTerminal);
  const pvValues = pvFcff && dcfPeriods.size ? [...dcfPeriods.values()].map((column) => valueOf(at(pvFcff.sheet, pvFcff.row, column))).filter((value): value is number => value !== null) : []; const evValue = ev ? valueOf(at(ev.sheet, ev.row, ev.cell.column + 1)) : null;
  if (evValue !== null && terminalPv !== null && pvValues.length === dcfPeriods.size) { const expected = pvValues.reduce((sum, value) => sum + value, 0) + terminalPv; if (Math.abs(evValue - expected) > policy.tolerance) fail(issues, checks, "MG-DCF-007", "dcf", "high", "Enterprise value bridge does not reconcile", "Enterprise value should equal the sum of forecast FCFF present values plus PV terminal value.", ev, { observed: String(evValue), expected: String(expected), difference: (evValue - expected).toFixed(3), tolerance: policy.tolerance.toFixed(3) }); else pass(checks, "MG-DCF-007", "dcf", ev); } else cannot(issues, checks, "MG-DCF-007", "dcf", "Enterprise value bridge cannot be verified", "Forecast PVs, PV terminal value, or enterprise value mapping is incomplete.", ev);
  const equityValue = equity ? valueOf(at(equity.sheet, equity.row, equity.cell.column + 1)) : null; if (evValue !== null && equityValue !== null && netDebt.value !== null && other.value !== null) { const expected = evValue - netDebt.value + other.value; if (Math.abs(equityValue - expected) > policy.tolerance) fail(issues, checks, "MG-DCF-008", "dcf", "high", "Equity value bridge does not reconcile", "Equity value should equal enterprise value less net debt plus explicitly mapped other equity adjustments.", equity, { observed: String(equityValue), expected: String(expected), difference: (equityValue - expected).toFixed(3), tolerance: policy.tolerance.toFixed(3) }); else pass(checks, "MG-DCF-008", "dcf", equity); } else cannot(issues, checks, "MG-DCF-008", "dcf", "Equity value bridge cannot be verified", "Enterprise value, net debt, other adjustments, or equity value mapping is incomplete.", equity);
  const shares = inputNumber(/diluted shares/i); const impliedValue = implied ? valueOf(at(implied.sheet, implied.row, implied.cell.column + 1)) : null; if (equityValue !== null && shares.value !== null && impliedValue !== null && shares.value > 0) { const expected = equityValue / shares.value; if (Math.abs(impliedValue - expected) > policy.tolerance) fail(issues, checks, "MG-DCF-009", "dcf", "high", "Implied share value does not reconcile", "Implied share value should equal equity value divided by diluted shares.", implied, { observed: String(impliedValue), expected: String(expected), difference: (impliedValue - expected).toFixed(3), tolerance: policy.tolerance.toFixed(3) }); else pass(checks, "MG-DCF-009", "dcf", implied); } else cannot(issues, checks, "MG-DCF-009", "dcf", "Implied share value cannot be verified", "Equity value, positive diluted shares, or implied share-value mapping is incomplete.", implied);
  if (evValue !== null && terminalPv !== null) { const concentration = terminalPv / evValue; if (concentration > policy.terminalValueConcentrationWarning) fail(issues, checks, "MG-DCF-010", "dcf", "medium", "Terminal value concentration exceeds ModelGuard review threshold", `PV Terminal Value is ${(concentration * 100).toFixed(1)}% of Enterprise Value. This is a ModelGuard review threshold, not a universal finance rule.`, pvTerminal, { observed: concentration.toFixed(4), expected: `At or below ${policy.terminalValueConcentrationWarning.toFixed(2)}` }); else pass(checks, "MG-DCF-010", "dcf", pvTerminal); } else cannot(issues, checks, "MG-DCF-010", "dcf", "Terminal value concentration cannot be verified", "Enterprise value or PV terminal mapping is incomplete.", pvTerminal);
  if (finalFcff !== null && finalFcff <= 0) fail(issues, checks, "MG-DCF-011", "dcf", "medium", "Terminal-year FCFF is not positive", "A conventional positive-growth Gordon terminal value may not represent a stabilized positive-cash-flow case.", fcff, { observed: String(finalFcff), expected: "> 0" }); else if (finalFcff !== null) pass(checks, "MG-DCF-011", "dcf", fcff); else cannot(issues, checks, "MG-DCF-011", "dcf", "Terminal-year FCFF cannot be verified", "Terminal-year FCFF mapping is incomplete.", fcff);
}

function scenarioAudit(workbook: ParsedWorkbook, issues: AuditIssue[], checks: AuditCheck[], policy: FinanceAuditPolicy): void {
  const sheet = sheetNamed(workbook, /scenario/i); if (!sheet) { notApplicable(checks, "MG-SCN-001", "scenario"); notApplicable(checks, "MG-SCN-002", "scenario"); notApplicable(checks, "MG-SCN-003", "scenario"); notApplicable(checks, "MG-SCN-004", "scenario"); notApplicable(checks, "MG-SCN-005", "scenario"); return; }
  const headers = new Map(sheet.cells.filter((cell) => cell.row === 4).map((cell) => [String(cell.value), cell.column])); const bear = headers.get("Bear"); const base = headers.get("Base"); const bull = headers.get("Bull"); if (!bear || !base || !bull) { for (const id of ["MG-SCN-001", "MG-SCN-002", "MG-SCN-003", "MG-SCN-004", "MG-SCN-005"]) cannot(issues, checks, id, "scenario", "Scenario integrity cannot be verified", "Bear/Base/Bull columns are not mapped.", { sheet, cell: sheet.cells[0] ?? { address: "A1", row: 1, column: 1, kind: "blank", value: null }, row: sheet.cells[0]?.row ?? 1, label: "scenario" }); return; }
  const rows = [/revenue growth/i, /operating margin|ebit margin/i, /wacc/i, /terminal growth/i, /implied share value|output/i].map((pattern) => locate(sheet, pattern));
  if (rows.slice(0, 4).some((row) => !row)) { cannot(issues, checks, "MG-SCN-001", "scenario", "Scenario assumptions cannot be verified", "Core scenario assumption mappings are incomplete.", rows.find(Boolean)); return; }
  const values = rows.map((row) => row ? [valueOf(at(sheet, row.row, bear)), valueOf(at(sheet, row.row, base)), valueOf(at(sheet, row.row, bull))] : [null, null, null]);
  const same = values.slice(0, 4).every(([a, b, c]) => a !== null && a === b && b === c); if (same) fail(issues, checks, "MG-SCN-001", "scenario", "high", "Bear, Base, and Bull assumptions are identical", "Core scenarios should not all use identical assumptions unless explicitly documented.", rows[0]); else pass(checks, "MG-SCN-001", "scenario", rows[0]);
  const [growth, margin, wacc] = values; const ordered = (row: (number | null)[] | undefined, descending = false) => row && row.every((value) => value !== null) && (descending ? (row[0] as number) >= (row[1] as number) && (row[1] as number) >= (row[2] as number) : (row[0] as number) <= (row[1] as number) && (row[1] as number) <= (row[2] as number)); if (ordered(growth) && ordered(margin) && ordered(wacc, true)) pass(checks, "MG-SCN-002", "scenario", rows[0]); else fail(issues, checks, "MG-SCN-002", "scenario", "medium", "Scenario assumption ordering needs review", "Bear/Base/Bull ordering is a ModelGuard policy heuristic, not a universal truth.", rows[0], { expected: "Growth and margin Bear ≤ Base ≤ Bull; WACC Bear ≥ Base ≥ Bull" });
  const output = values[4]; if (output.every((value) => value !== null)) { if ((output[0] as number) <= (output[1] as number) && (output[1] as number) <= (output[2] as number)) pass(checks, "MG-SCN-003", "scenario", rows[4]); else fail(issues, checks, "MG-SCN-003", "scenario", "high", "Scenario output ordering needs review", "Bear value should normally be no greater than Base, and Base no greater than Bull. This is a review signal, not a formula verdict.", rows[4]); const assumptionChanged = values.slice(0, 4).some((row) => row[0] !== row[2] && row[0] !== null && row[2] !== null && Math.abs((row[0] as number) - (row[2] as number)) >= policy.scenarioMaterialChange); if (assumptionChanged && output[0] === output[2]) fail(issues, checks, "MG-SCN-004", "scenario", "high", "Scenario output is disconnected", "Core scenario assumptions change materially but the mapped valuation output does not change.", rows[4]); else pass(checks, "MG-SCN-004", "scenario", rows[4]); } else cannot(issues, checks, "MG-SCN-003", "scenario", "Scenario output cannot be verified", "Mapped scenario output cells are missing.", rows[4]);
  const formulaCells = sheet.cells.filter((cell) => cell.column === bear || cell.column === base || cell.column === bull); if (formulaCells.some((cell) => cell.kind === "formula")) pass(checks, "MG-SCN-005", "scenario", rows[0]); else cannot(issues, checks, "MG-SCN-005", "scenario", "Scenario formula structure cannot be verified", "No normalized scenario formulas were found.", rows[0]);
}

function assumptionAudit(workbook: ParsedWorkbook, issues: AuditIssue[], checks: AuditCheck[], policy: FinanceAuditPolicy): void {
  const inputs = sheetNamed(workbook, /^inputs?$/i); if (!inputs) { for (const id of ["MG-ASM-001", "MG-ASM-002", "MG-ASM-003", "MG-ASM-004", "MG-ASM-005", "MG-ASM-006"]) cannot(issues, checks, id, "assumption", "Assumption governance cannot be verified", "Inputs or forecast mapping is missing."); return; }
  const header = new Map(inputs.cells.filter((cell) => cell.row === 4).map((cell) => [String(cell.value).toLowerCase(), cell.column])); const sourceColumn = header.get("source / basis") ?? header.get("source"); const ownerColumn = header.get("owner"); const dateColumn = header.get("date");
  const assumptions = inputs.cells.filter((cell) => cell.column === 1 && cell.row > 4 && cell.value !== null);
  const missingSource = sourceColumn ? assumptions.find((row) => !String(at(inputs, row.row, sourceColumn)?.value ?? "").trim()) : assumptions[0]; const missingOwner = ownerColumn ? assumptions.find((row) => !String(at(inputs, row.row, ownerColumn)?.value ?? "").trim()) : assumptions[0];
  if (missingSource) fail(issues, checks, "MG-ASM-001", "assumption", "medium", "Assumption source is missing", "Each assumption should identify its source or basis. Review suggested.", { sheet: inputs, cell: missingSource, row: missingSource.row, label: String(missingSource.value) }); else pass(checks, "MG-ASM-001", "assumption");
  if (missingOwner) fail(issues, checks, "MG-ASM-002", "assumption", "medium", "Assumption owner is missing", "Each assumption should identify an owner. Review suggested.", { sheet: inputs, cell: missingOwner, row: missingOwner.row, label: String(missingOwner.value) }); else pass(checks, "MG-ASM-002", "assumption");
  const waccRow = locate(inputs, /wacc/i); const growthRow = locate(inputs, /terminal growth/i); const marked = (row: Located | undefined) => row && (String(at(inputs, row.row, sourceColumn ?? 4)?.value ?? "").toLowerCase().includes("analyst") || String(at(inputs, row.row, ownerColumn ?? 3)?.value ?? "").toLowerCase().includes("analyst")); if (marked(waccRow) && marked(growthRow)) pass(checks, "MG-ASM-003", "assumption", waccRow); else fail(issues, checks, "MG-ASM-003", "assumption", "medium", "WACC or terminal growth is not explicitly marked as an analyst assumption", "Make assumption ownership and basis visible before relying on these inputs.", waccRow ?? growthRow);
  const income = sheetNamed(workbook, /income statement/i); const map = periods(income ?? ({ cells: [], name: "", state: "visible", mergedRanges: [] } as ParsedSheet)); const revenue = locate(income, /^revenue$/i); const ebit = locate(income, /^ebit$|operating income/i); if (revenue && ebit && map.size >= 2) { const cols = [...map.values()]; const historical = valueOf(at(income as ParsedSheet, revenue.row, cols[0])); const forecast = valueOf(at(income as ParsedSheet, revenue.row, cols[1])); const histEbit = valueOf(at(income as ParsedSheet, ebit.row, cols[0])); const forecastEbit = valueOf(at(income as ParsedSheet, ebit.row, cols[1])); if (historical !== null && forecast !== null && Math.abs(forecast / historical - 1) > policy.abruptForecastStep) fail(issues, checks, "MG-ASM-004", "assumption", "medium", "Forecast step changes abruptly", "The first forecast revenue step exceeds the configurable review threshold. Review suggested.", revenue, { observed: `${historical} → ${forecast}`, expected: `Step within ${policy.abruptForecastStep}` }); else pass(checks, "MG-ASM-004", "assumption", revenue); if (histEbit !== null && forecastEbit !== null && historical !== null && forecast !== null && historical !== 0 && forecast !== 0 && Math.abs(forecastEbit / forecast - histEbit / historical) > policy.forecastMarginJump) fail(issues, checks, "MG-ASM-005", "assumption", "medium", "Forecast margin jumps abruptly", "The first forecast margin differs materially from the latest historical margin. Review suggested.", ebit, { observed: `${(histEbit / historical).toFixed(3)} → ${(forecastEbit / forecast).toFixed(3)}`, expected: `Change within ${policy.forecastMarginJump}` }); else pass(checks, "MG-ASM-005", "assumption", ebit); const forecastColumns = cols.slice(1); const hardcoded = (income as ParsedSheet).cells.filter((cell) => forecastColumns.includes(cell.column) && cell.row > 4 && cell.kind === "value" && typeof cell.value === "number"); if (hardcoded.length) for (const cell of hardcoded) fail(issues, checks, "MG-ASM-006", "assumption", "medium", "Forecast cell is hardcoded", "A forecast-period value is hardcoded instead of linked by formula. Review the source or document the assumption explicitly.", { sheet: income as ParsedSheet, cell, row: cell.row, label: String(cell.value) }, { observed: String(cell.value), expected: "A formula or documented assumption" }); else pass(checks, "MG-ASM-006", "assumption", revenue); } else { cannot(issues, checks, "MG-ASM-004", "assumption", "Forecast step cannot be verified", "Revenue and period mappings are incomplete.", revenue); cannot(issues, checks, "MG-ASM-005", "assumption", "Forecast margin jump cannot be verified", "Revenue, EBIT, and period mappings are incomplete.", ebit); cannot(issues, checks, "MG-ASM-006", "assumption", "Forecast hardcode cannot be verified", "Income Statement forecast period mapping is incomplete.", revenue); }
  void dateColumn;
}

export function runFinancialAudit(workbook: ParsedWorkbook, policy: FinanceAuditPolicy = DEFAULT_FINANCE_AUDIT_POLICY): { issues: AuditIssue[]; checks: AuditCheck[] } {
  const issues: AuditIssue[] = []; const checks: AuditCheck[] = [];
  accountingAudit(workbook, issues, checks, policy); dcfAudit(workbook, issues, checks, policy); scenarioAudit(workbook, issues, checks, policy); assumptionAudit(workbook, issues, checks, policy);
  return { issues, checks };
}
