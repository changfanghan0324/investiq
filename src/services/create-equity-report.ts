// Purpose: Pure, deterministic assembly of an evidence-linked equity research report.
// This file performs no I/O, reads no clock, generates no prose with AI, and never fills a
// missing field with zero. Reported facts, modeled assumptions, and analyst-authored notes are
// structurally separate so a consumer cannot mistake one category for another.

import type { CompanyRatioSeries } from "@/domain/company-financial-analysis";
import type {
  FundamentalsMetricKey,
  FundamentalsResult,
  FundamentalsSeries,
  SourceReceipt,
} from "@/domain/fundamentals";
import type { ValuationSnapshot } from "@/services/valuation-snapshot";

export interface InvestmentMemoNotes {
  thesis: string;
  catalysts: string;
  risks: string;
  conclusion: string;
}

export interface EquityResearchReport {
  version: 1;
  generatedAt: string;
  identity: {
    ticker: string;
    name: string;
    cik: string;
    sicCode?: number;
    sicDescription?: string;
  };
  reportedFacts: {
    basis: FundamentalsResult["basis"];
    disclaimer: string;
    fiscalYears: number[];
    financials: FundamentalsSeries[];
    ratios: CompanyRatioSeries[];
  };
  modeledAssumptions?: {
    generatedAt: string;
    fiscalYear: number;
    assumptions: ValuationSnapshot["assumptions"];
    values: Omit<ValuationSnapshot["values"], "currentPrice" | "quoteDate" | "upsideDownside"> & {
      currentPrice?: number;
      quoteDate?: string;
    };
  };
  userInterpretation: InvestmentMemoNotes;
  sources: EquityReportSource[];
  limitations: EquityReportLimitation[];
  disclaimers: readonly EquityReportDisclaimer[];
}

export interface EquityReportSource {
  accn: string;
  form: string;
  fy: number;
  filed: string;
  sourceUrl: string;
  concepts: string[];
}

export type EquityReportDisclaimer = "educational-only" | "assumption-dependent" | "no-recommendation";

export type EquityReportLimitation =
  | "business-narrative-not-sourced"
  | "peers-not-sourced"
  | "sector-not-sourced"
  | "valuation-not-run"
  | "dated-price-unavailable"
  | "unavailable-sec-facts"
  | "historical-not-forecast";

const REPORT_METRICS: readonly FundamentalsMetricKey[] = [
  "revenue",
  "grossProfit",
  "operatingIncome",
  "netIncome",
  "dilutedEps",
  "operatingCashFlow",
  "capitalExpenditure",
  "freeCashFlow",
  "ebitda",
  "totalDebt",
  "cashAndEquivalents",
];

const GENERATED_AT_PATTERN = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z)?$/;

export function buildEquityResearchReport(input: {
  fundamentals: FundamentalsResult;
  ratios: CompanyRatioSeries[];
  valuation?: ValuationSnapshot;
  notes: InvestmentMemoNotes;
  generatedAt: string;
}): EquityResearchReport {
  if (!GENERATED_AT_PATTERN.test(input.generatedAt)) {
    throw new Error("Equity research report generatedAt must be an ISO date or UTC timestamp.");
  }

  const financials = REPORT_METRICS.map((key) =>
    input.fundamentals.metrics.find((series) => series.metric === key),
  ).filter((series): series is FundamentalsSeries => series !== undefined);

  const sources = dedupeReceipts([
    ...financials.flatMap((series) => series.observations.flatMap((observation) => observation.receipts)),
    ...input.ratios.flatMap((series) => series.observations.flatMap((observation) => observation.receipts)),
  ]);

  const datedPrice = input.valuation?.values.currentPrice !== undefined && input.valuation.values.quoteDate
    ? { currentPrice: input.valuation.values.currentPrice, quoteDate: input.valuation.values.quoteDate }
    : {};
  const modeledAssumptions = input.valuation
    ? {
        generatedAt: input.valuation.generatedAt,
        fiscalYear: input.valuation.fiscalYear,
        assumptions: structuredClone(input.valuation.assumptions),
        values: {
          bear: input.valuation.values.bear,
          base: input.valuation.values.base,
          bull: input.valuation.values.bull,
          low: input.valuation.values.low,
          high: input.valuation.values.high,
          enterpriseValue: input.valuation.values.enterpriseValue,
          equityValue: input.valuation.values.equityValue,
          ...datedPrice,
        },
      }
    : undefined;

  const limitations: EquityReportLimitation[] = [
    "business-narrative-not-sourced",
    "peers-not-sourced",
    "sector-not-sourced",
    ...(modeledAssumptions ? [] : ["valuation-not-run" as const]),
    ...(modeledAssumptions?.values.currentPrice === undefined ? ["dated-price-unavailable" as const] : []),
    ...(input.fundamentals.coverage.unavailable.length > 0 ? ["unavailable-sec-facts" as const] : []),
    "historical-not-forecast",
  ];

  return {
    version: 1,
    generatedAt: input.generatedAt,
    identity: {
      ticker: input.fundamentals.identity.ticker,
      name: input.fundamentals.identity.name,
      cik: input.fundamentals.identity.cik,
      sicCode: input.fundamentals.identity.sicCode,
      sicDescription: input.fundamentals.identity.sicDescription,
    },
    reportedFacts: {
      basis: input.fundamentals.basis,
      disclaimer: input.fundamentals.disclaimer,
      fiscalYears: [...input.fundamentals.fiscalYears],
      financials: structuredClone(financials),
      ratios: structuredClone(input.ratios),
    },
    modeledAssumptions,
    userInterpretation: sanitizeNotes(input.notes),
    sources,
    limitations,
    disclaimers: ["educational-only", "assumption-dependent", "no-recommendation"],
  };
}

function sanitizeNotes(notes: InvestmentMemoNotes): InvestmentMemoNotes {
  return {
    thesis: sanitizeText(notes.thesis),
    catalysts: sanitizeText(notes.catalysts),
    risks: sanitizeText(notes.risks),
    conclusion: sanitizeText(notes.conclusion),
  };
}

function sanitizeText(value: string): string {
  return value.replace(/\u0000/g, "").slice(0, 4_000);
}

function dedupeReceipts(receipts: SourceReceipt[]): EquityReportSource[] {
  const filings = new Map<string, EquityReportSource>();
  for (const receipt of receipts) {
    const key = `${receipt.accn}:${receipt.sourceUrl}`;
    const current = filings.get(key);
    if (current) {
      if (!current.concepts.includes(receipt.concept)) current.concepts.push(receipt.concept);
      continue;
    }
    filings.set(key, {
      accn: receipt.accn,
      form: receipt.form,
      fy: receipt.fy,
      filed: receipt.filed,
      sourceUrl: receipt.sourceUrl,
      concepts: [receipt.concept],
    });
  }
  return [...filings.values()]
    .map((filing) => ({ ...filing, concepts: filing.concepts.sort() }))
    .sort((left, right) => right.filed.localeCompare(left.filed) || left.accn.localeCompare(right.accn));
}
