// Purpose: Ensures portfolios are no longer restricted to two holdings.

import assert from "node:assert/strict";
import { describe, it, vi } from "vitest";

import { getBrokerPreset } from "@/constants/broker-presets";
import { createDemoMarketData } from "@/data/demo-market-data";
import { runBacktest } from "@/domain/backtest-engine";
import type { BacktestInput, PortfolioInput } from "@/types/backtest";

describe("portfolio report orchestration", () => {
  it("calculates more than two holdings without a product limit", async () => {
    vi.doMock("@/services/create-report", () => ({
      createReport: async ({ input: holdingInput, demoSeed }: { input: BacktestInput; demoSeed?: number }) => {
        const marketData = createDemoMarketData(holdingInput.ticker, demoSeed);
        return {
          input: holdingInput,
          marketData,
          historical: runBacktest(holdingInput, marketData),
        };
      },
    }));
    const { createPortfolioReport } = await import("@/services/create-portfolio-report");
    const input: PortfolioInput = {
      positions: ["AAA", "BBB", "CCC"].map((ticker, index) => ({
        id: `position-${index}`,
        ticker,
        investment: { mode: "amount", value: 100, intervalValue: 1, intervalUnit: "months" },
      })),
      startDate: "2024-01-02",
      endDate: "2024-12-31",
      taxMode: "pre-tax",
      dividendTaxRate: 0,
      liquidateAtEnd: false,
      capitalGainsTaxRate: 0,
      fees: getBrokerPreset("custom"),
    };

    const report = await createPortfolioReport({ input, demo: true });

    assert.equal(report.holdings.length, 3);
    assert.equal(report.historical?.holdingsCount, 3);
  });
});
