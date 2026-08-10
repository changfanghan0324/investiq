import ExcelJS from "exceljs";
import path from "node:path";

const samples = path.join(process.cwd(), "public", "samples");
const periods = ["2024A", "2025E", "2026E", "2027E"];

function formula(sheet: ExcelJS.Worksheet, address: string, expression: string, result: number | string | null): void {
  sheet.getCell(address).value = { formula: expression.replace(/^=/, ""), result } as never;
}

function styleSheet(sheet: ExcelJS.Worksheet, title: string, subtitle: string): void {
  sheet.getCell("A1").value = title;
  sheet.getCell("A2").value = subtitle;
  sheet.getCell("A1").font = { name: "Arial", bold: true, size: 14 };
  sheet.getCell("A2").font = { name: "Arial", italic: true, color: { argb: "666666" } };
  sheet.getColumn(1).width = 28;
  for (const column of ["B", "C", "D", "E", "F"]) sheet.getColumn(column).width = 16;
}

function addPeriodHeader(sheet: ExcelJS.Worksheet): void {
  sheet.getRow(4).values = ["Metric", ...periods];
  sheet.getRow(4).font = { name: "Arial", bold: true };
}

function addInputs(workbook: ExcelJS.Workbook): void {
  const sheet = workbook.addWorksheet("Inputs");
  styleSheet(sheet, "Inputs", "Self-authored smoke fixture; values are illustrative only.");
  sheet.getRow(4).values = ["Assumption", "Value", "Owner", "Source / Basis", "Date"];
  sheet.getRow(4).font = { name: "Arial", bold: true };
  const rows: Array<[string, number, string, string]> = [
    ["Revenue Growth", 0.08, "Analyst", "Planning case"],
    ["Operating Margin", 0.22, "Analyst", "Planning case"],
    ["Cash Tax Rate", 0.25, "Analyst", "Policy assumption"],
    ["CapEx / Revenue", 0.05, "Analyst", "Maintenance plan"],
    ["Change in NWC / Revenue", 0.02, "Analyst", "Working capital plan"],
    ["WACC", 0.09, "Analyst", "Discount-rate assumption"],
    ["Terminal Growth", 0.025, "Analyst", "Gordon-growth assumption"],
    ["Diluted Shares", 100, "Finance", "Capitalization schedule"],
    ["Net Debt", 500, "Finance", "Debt and cash schedule"],
    ["Other Equity Adjustments", 0, "Finance", "Declared none"],
  ];
  rows.forEach(([label, value, owner, source], index) => {
    const row = index + 5;
    sheet.getCell(`A${row}`).value = label;
    sheet.getCell(`B${row}`).value = value;
    sheet.getCell(`C${row}`).value = owner;
    sheet.getCell(`D${row}`).value = source;
    sheet.getCell(`E${row}`).value = "2026-08-10";
  });
}

function addThreeStatementSheets(workbook: ExcelJS.Workbook): void {
  const income = workbook.addWorksheet("Income Statement");
  styleSheet(income, "Income Statement", "Illustrative USD millions.");
  addPeriodHeader(income);
  income.getCell("A5").value = "Revenue";
  income.getCell("B5").value = 1000;
  for (const [index, column] of ["C", "D", "E"].entries()) formula(income, `${column}5`, `=${index === 0 ? "B" : String.fromCharCode(66 + index)}5*(1+Inputs!$B$5)`, [1080, 1166.4, 1259.712][index]);
  income.getCell("A6").value = "EBIT";
  for (const [index, column] of ["B", "C", "D", "E"].entries()) formula(income, `${column}6`, `=${column}5*Inputs!$B$6`, [220, 237.6, 256.608, 277.137][index]);

  const balance = workbook.addWorksheet("Balance Sheet");
  styleSheet(balance, "Balance Sheet", "Illustrative USD millions.");
  addPeriodHeader(balance);
  for (const [row, label, values] of [[5, "Assets", [1000, 1100, 1200, 1300]], [6, "Liabilities", [400, 440, 480, 520]], [7, "Equity", [600, 660, 720, 780]]] as const) {
    balance.getCell(`A${row}`).value = label;
    values.forEach((value, index) => balance.getCell(`${String.fromCharCode(66 + index)}${row}`).value = value);
  }

  const cash = workbook.addWorksheet("Cash Flow");
  styleSheet(cash, "Cash Flow", "Illustrative USD millions.");
  addPeriodHeader(cash);
  const cashRows: Array<[number, string, number[]]> = [
    [5, "Beginning Cash", [100, 120, 140, 160]],
    [6, "Net Change in Cash", [20, 20, 20, 20]],
    [7, "Ending Cash", [120, 140, 160, 180]],
    [8, "D&A", [30, 32, 34, 36]],
    [9, "CapEx", [40, 43.2, 46.656, 50.39]],
    [10, "Change in NWC", [16, 17.28, 18.662, 20.155]],
  ];
  for (const [row, label, values] of cashRows) {
    cash.getCell(`A${row}`).value = label;
    values.forEach((value, index) => cash.getCell(`${String.fromCharCode(66 + index)}${row}`).value = value);
  }
}

function addDcfSheet(workbook: ExcelJS.Workbook): void {
  const dcf = workbook.addWorksheet("DCF");
  styleSheet(dcf, "DCF", "Illustrative valuation mechanics; not an investment recommendation.");
  addPeriodHeader(dcf);
  dcf.getCell("A5").value = "FCFF";
  [165, 171.12, 177.4368, 184.534].forEach((value, index) => formula(dcf, `${String.fromCharCode(66 + index)}5`, `='Cash Flow'!${String.fromCharCode(66 + index)}8`, value));
  dcf.getCell("A6").value = "Discount Factor";
  [0.917431, 0.84168, 0.772183, 0.708425].forEach((value, index) => formula(dcf, `${String.fromCharCode(66 + index)}6`, `=1/(1+Inputs!$B$10)^${index + 1}`, value));
  dcf.getCell("A7").value = "PV FCFF";
  [151.376, 144.099, 136.999, 130.722].forEach((value, index) => formula(dcf, `${String.fromCharCode(66 + index)}7`, `=${String.fromCharCode(66 + index)}5*${String.fromCharCode(66 + index)}6`, value));
  dcf.getCell("A8").value = "Terminal Value";
  formula(dcf, "B8", "=E5*(1+Inputs!$B$11)/(Inputs!$B$10-Inputs!$B$11)", 2736.37);
  dcf.getCell("A9").value = "Terminal Discount Factor";
  formula(dcf, "B9", "=E6", 0.708425);
  dcf.getCell("A10").value = "PV Terminal Value";
  formula(dcf, "B10", "=B8*B9", 1938.84);
  dcf.getCell("A11").value = "Enterprise Value";
  formula(dcf, "B11", "=SUM(B7:E7)+B10", 2502.04);
  dcf.getCell("A12").value = "Equity Value";
  formula(dcf, "B12", "=B11-Inputs!B13+Inputs!B14", 2002.04);
  dcf.getCell("A13").value = "Diluted Shares";
  formula(dcf, "B13", "=Inputs!B12", 100);
  dcf.getCell("A14").value = "Implied Share Value";
  formula(dcf, "B14", "=B12/B13", 20.02);
}

async function save(workbook: ExcelJS.Workbook, name: string): Promise<void> {
  workbook.calcProperties.fullCalcOnLoad = false;
  await workbook.xlsx.writeFile(path.join(samples, name));
}

async function createThreeStatementDcf(): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "ModelGuard";
  addInputs(workbook);
  addThreeStatementSheets(workbook);
  addDcfSheet(workbook);
  await save(workbook, "modelguard-smoke-three-statement-dcf.xlsx");
}

async function createDcfOnly(): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "ModelGuard";
  addInputs(workbook);
  addDcfSheet(workbook);
  await save(workbook, "modelguard-smoke-dcf-only.xlsx");
}

async function createFpaForecast(): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "ModelGuard";
  addInputs(workbook);
  const income = workbook.addWorksheet("Income Statement");
  styleSheet(income, "Income Statement", "FP&A forecast smoke fixture; illustrative USD millions.");
  addPeriodHeader(income);
  income.getCell("A5").value = "Revenue";
  income.getCell("B5").value = 1000;
  formula(income, "C5", "=B5*(1+Inputs!$B$5)", 1080);
  formula(income, "D5", "=C5*(1+Inputs!$B$5)", 1166.4);
  formula(income, "E5", "=D5*(1+Inputs!$B$5)", 1259.712);
  income.getCell("A6").value = "EBIT";
  formula(income, "B6", "=B5*Inputs!$B$6", 220);
  formula(income, "C6", "=C5*Inputs!$B$6", 237.6);
  formula(income, "D6", "=D5*Inputs!$B$6", 256.608);
  formula(income, "E6", "=E5*Inputs!$B$6", 277.137);
  const cash = workbook.addWorksheet("Cash Flow");
  styleSheet(cash, "Cash Flow", "FP&A forecast cash bridge; illustrative USD millions.");
  addPeriodHeader(cash);
  cash.getCell("A5").value = "Beginning Cash";
  [100, 120, 140, 160].forEach((value, index) => cash.getCell(`${String.fromCharCode(66 + index)}5`).value = value);
  cash.getCell("A6").value = "Net Change in Cash";
  [20, 20, 20, 20].forEach((value, index) => cash.getCell(`${String.fromCharCode(66 + index)}6`).value = value);
  cash.getCell("A7").value = "Ending Cash";
  [120, 140, 160, 180].forEach((value, index) => formula(cash, `${String.fromCharCode(66 + index)}7`, `=${String.fromCharCode(66 + index)}5+${String.fromCharCode(66 + index)}6`, value));
  await save(workbook, "modelguard-smoke-fpa-forecast.xlsx");
}

async function main(): Promise<void> {
  await createThreeStatementDcf();
  await createDcfOnly();
  await createFpaForecast();
}

void main();
