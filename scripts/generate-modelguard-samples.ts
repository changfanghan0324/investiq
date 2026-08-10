import ExcelJS from "exceljs";
import { readFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const samples = path.join(root, "public", "samples");

async function openSample(name: string): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await readFile(path.join(samples, name)) as never);
  return workbook;
}

function formula(sheet: ExcelJS.Worksheet, address: string, expression: string, result: string | number | null): void {
  sheet.getCell(address).value = { formula: expression.replace(/^=/, ""), result } as never;
}

function value(sheet: ExcelJS.Worksheet, address: string, next: string | number | null): void {
  sheet.getCell(address).value = next as never;
}

function formulaResults(sheet: ExcelJS.Worksheet, rows: Record<string, string | number | null>): void {
  for (const [address, result] of Object.entries(rows)) {
    const cell = sheet.getCell(address);
    if (cell.type === ExcelJS.ValueType.Formula && typeof cell.value === "object" && cell.value !== null && "formula" in cell.value) {
      formula(sheet, address, String(cell.value.formula), result);
    }
  }
}

function setCleanResults(workbook: ExcelJS.Workbook): void {
  const income = workbook.getWorksheet("Income Statement")!;
  const cash = workbook.getWorksheet("Cash Flow")!;
  const balance = workbook.getWorksheet("Balance Sheet")!;
  const debt = workbook.getWorksheet("Debt Schedule")!;
  const dcf = workbook.getWorksheet("DCF")!;
  const scenarios = workbook.getWorksheet("Scenarios")!;

  // Keep the clean fixture Excel-valid: sheet names with spaces are quoted.
  for (const column of ["C", "D", "E", "F"]) formula(balance, `${column}13`, `='Debt Schedule'!${column}7`, ({ C: 405, D: 410, E: 415, F: 420 } as Record<string, number>)[column]);
  for (const [address, result] of Object.entries({ C7: 310, D7: 315, E7: 320, F7: 327 })) formulaResults(balance, { [address]: result });
  for (const [address, result] of Object.entries({ C8: 345, D8: 505.38, E8: 678.59, F8: 865.657, C12: 505.38, D12: 678.59, E12: 865.657, F12: 1067.689 })) formulaResults(balance, { [address]: result });

  const fcff = { B11: 165, C11: 167.4, D11: 180.792, E11: 195.255, F11: 210.874 };
  formulaResults(cash, fcff);
  formulaResults(dcf, { B5: 165, C5: 167.4, D5: 180.792, E5: 195.255, F5: 210.874, B7: 151.376, C7: 140.897, D7: 139.605, E7: 138.324, F7: 137.054, B8: 3325.321, B9: 0.649931, B10: 2161.229, B11: 2868.484, B12: 2368.484, B13: 100, B14: 23.685 });

  // A scenario output is deliberately formula-backed in the clean fixture.
  formula(scenarios, "B9", "=B5*100+B6*20-B7*50+B8*10", 18);
  formula(scenarios, "C9", "=C5*100+C6*20-C7*50+C8*10", 22.87);
  formula(scenarios, "D9", "=D5*100+D6*20-D7*50+D8*10", 30);

  // The clean model has no external-link or formula-error probe.
  value(dcf, "B15", null);
  value(dcf, "B16", null);
  value(dcf, "B17", null);
  value(dcf, "B18", null);
  void income;
  void debt;
}

function setErrorSeeds(workbook: ExcelJS.Workbook): void {
  const inputs = workbook.getWorksheet("Inputs")!;
  const income = workbook.getWorksheet("Income Statement")!;
  const cash = workbook.getWorksheet("Cash Flow")!;
  const balance = workbook.getWorksheet("Balance Sheet")!;
  const debt = workbook.getWorksheet("Debt Schedule")!;
  const dcf = workbook.getWorksheet("DCF")!;
  const scenarios = workbook.getWorksheet("Scenarios")!;

  value(inputs, "B10", 0.07);
  value(inputs, "B11", 0.08);
  value(inputs, "C10", null);
  value(inputs, "D10", null);

  // One hardcoded forecast step and one deliberately broken reference family.
  value(income, "C5", 1500);
  formulaResults(cash, { C7: 999 });
  formula(dcf, "B15", "='[external.xlsx]Sheet1'!$B$2", null);
  formula(dcf, "B16", "='Missing Sheet'!$B$2", null);
  formula(dcf, "B17", "=Inputs!$B$99", null);
  formula(dcf, "B18", "=1/0", "#DIV/0!");

  for (const [address, result] of Object.entries({ C7: 305, D7: 310, E7: 315 })) formulaResults(balance, { [address]: result });
  formulaResults(balance, { C12: 361.134, D12: 377.345, E12: 394.412, F12: 400 });
  formulaResults(debt, { F7: 430 });
  formulaResults(dcf, { B5: 171, D5: 181.142, E5: 194.54, F5: 250, D6: 0.95, D7: 139.86, E7: 999, F7: 136.8, B10: 999, B11: 999, B12: 888, B13: 90, B14: 1 });

  for (const address of ["B5", "C5", "D5", "B6", "C6", "D6", "B7", "C7", "D7", "B8", "C8", "D8"]) value(scenarios, address, address.endsWith("5") ? 0.08 : address.endsWith("6") ? 0.22 : address.endsWith("7") ? 0.09 : 0.025);
  value(scenarios, "B9", 22.87);
  value(scenarios, "C9", 22.87);
  value(scenarios, "D9", 22.87);
  const hidden = workbook.getWorksheet("Hidden Checks") ?? workbook.addWorksheet("Hidden Checks");
  hidden.state = "hidden";
  hidden.getCell("A1").value = "Review manually";
}

async function save(workbook: ExcelJS.Workbook, name: string): Promise<void> {
  workbook.calcProperties.fullCalcOnLoad = false;
  await workbook.xlsx.writeFile(path.join(samples, name));
}

async function main(): Promise<void> {
  const clean = await openSample("modelguard-clean-model.xlsx");
  setCleanResults(clean);
  await save(clean, "modelguard-clean-model.xlsx");

  const versionOne = await openSample("modelguard-clean-model.xlsx");
  await save(versionOne, "modelguard-version-1.xlsx");
  const versionTwo = await openSample("modelguard-clean-model.xlsx");
  value(versionTwo.getWorksheet("Inputs")!, "B5", 0.1);
  await save(versionTwo, "modelguard-version-2.xlsx");

  const error = await openSample("modelguard-clean-model.xlsx");
  setErrorSeeds(error);
  await save(error, "modelguard-error-model.xlsx");
}

void main();
