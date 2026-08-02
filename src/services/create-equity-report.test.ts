import { describe, expect, it } from "vitest";

import type { CompanyRatioSeries } from "@/domain/company-financial-analysis";
import type { FundamentalsResult, SourceReceipt } from "@/domain/fundamentals";
import { buildEquityResearchReport } from "@/services/create-equity-report";
import type { ValuationSnapshot } from "@/services/valuation-snapshot";

const receipt: SourceReceipt = {
  taxonomy: "us-gaap",
  concept: "RevenueFromContractWithCustomerExcludingAssessedTax",
  unit: "USD",
  accn: "0000000000-25-000001",
  form: "10-K",
  fp: "FY",
  fy: 2025,
  filed: "2025-10-30",
  start: "2024-09-29",
  end: "2025-09-27",
  sourceUrl: "https://www.sec.gov/Archives/edgar/data/1/000000000025000001/0000000000-25-000001-index.html",
};

const fundamentals: FundamentalsResult = {
  identity: {
    cik: "0000000001",
    ticker: "TEST",
    name: "Test Company",
    sicCode: 3571,
    sicDescription: "Electronic Computers",
    isFinancialIssuer: false,
    sectorClassification: null,
  },
  period: "annual",
  basis: "as-most-recently-reported",
  displayOnly: true,
  disclaimer: "As most recently reported; later restatements may apply.",
  fiscalYears: [2025, 2024],
  metrics: [
    {
      metric: "revenue",
      unit: "USD",
      basis: "Total revenue",
      available: true,
      observations: [
        { fiscalYear: 2025, periodEnd: "2025-09-27", value: 120, receipts: [receipt] },
        { fiscalYear: 2024, periodEnd: "2024-09-28", value: 100, receipts: [{ ...receipt, fy: 2024, end: "2024-09-28" }] },
      ],
    },
    {
      metric: "freeCashFlow",
      unit: "USD",
      basis: "Operating cash flow less capital expenditure",
      available: false,
      observations: [],
      unavailableReason: "Missing aligned facts.",
    },
  ],
  coverage: { unavailable: [{ metric: "freeCashFlow", reason: "Missing aligned facts." }] },
};

const ratios: CompanyRatioSeries[] = [{
  metric: "grossMargin",
  unit: "percent",
  formula: "Gross profit ÷ revenue",
  available: true,
  observations: [{ fiscalYear: 2025, periodEnd: "2025-09-27", value: 0.4, receipts: [receipt] }],
}];

const valuation: ValuationSnapshot = {
  version: 1,
  ticker: "TEST",
  generatedAt: "2026-08-01T00:00:00.000Z",
  fiscalYear: 2025,
  assumptions: {
    baseRevenue: 120,
    forecastYears: 5,
    revenueGrowth: 0.05,
    operatingMargin: 0.2,
    cashTaxRate: 0.21,
    daPercentOfRevenue: 0.03,
    capexPercentOfRevenue: 0.04,
    nwcPercentOfIncrementalRevenue: 0.01,
    wacc: 0.09,
    terminalGrowth: 0.025,
    netDebt: 10,
    dilutedShares: 5,
  },
  values: {
    bear: 18,
    base: 22,
    bull: 27,
    low: 18,
    high: 27,
    enterpriseValue: 120,
    equityValue: 110,
    currentPrice: 20,
  },
};

const notes = { thesis: "Evidence-based thesis", catalysts: "Observable catalyst", risks: "Known risk", conclusion: "Conditional interpretation" };

describe("buildEquityResearchReport", () => {
  it("keeps reported facts, modeled assumptions, and user interpretation structurally separate", () => {
    const report = buildEquityResearchReport({ fundamentals, ratios, valuation, notes, generatedAt: "2026-08-01" });

    expect(report.reportedFacts.financials[0].observations[0].value).toBe(120);
    expect(report.modeledAssumptions?.assumptions.wacc).toBe(0.09);
    expect(report.userInterpretation.thesis).toBe(notes.thesis);
    expect(report).not.toHaveProperty("businessDescription");
    expect(report.identity).not.toHaveProperty("sectorClassification");
    expect(report).not.toHaveProperty("peers");
  });

  it("withholds an undated current price and explains unavailable evidence", () => {
    const report = buildEquityResearchReport({ fundamentals, ratios, valuation, notes, generatedAt: "2026-08-01" });

    expect(report.modeledAssumptions?.values.currentPrice).toBeUndefined();
    expect(report.modeledAssumptions?.values.quoteDate).toBeUndefined();
    expect(report.limitations).toContain("dated-price-unavailable");
    expect(report.limitations).toContain("unavailable-sec-facts");
    expect(report.reportedFacts.financials.find((item) => item.metric === "freeCashFlow")?.observations).toEqual([]);
  });

  it("deduplicates source receipts and remains deterministic for identical inputs", () => {
    const input = { fundamentals, ratios, valuation: { ...valuation, values: { ...valuation.values, quoteDate: "2026-07-31" } }, notes, generatedAt: "2026-08-01" };
    const first = buildEquityResearchReport(input);
    const second = buildEquityResearchReport(input);

    expect(second).toEqual(first);
    expect(first.sources).toHaveLength(1);
    expect(first.sources[0].concepts).toEqual(["RevenueFromContractWithCustomerExcludingAssessedTax"]);
    expect(first.modeledAssumptions?.values.currentPrice).toBe(20);
  });

  it("fails closed when the caller does not inject a valid generation date", () => {
    expect(() => buildEquityResearchReport({ fundamentals, ratios, notes, generatedAt: "today" })).toThrow(/generatedAt/);
  });
});
