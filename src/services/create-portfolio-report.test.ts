// Purpose: Ensures portfolios are no longer restricted to two holdings.

import assert from "node:assert/strict";
import { afterEach, describe, it, vi } from "vitest";

import { getBrokerPreset } from "@/constants/broker-presets";
import { createDemoMarketData } from "@/data/demo-market-data";
import { runBacktest } from "@/domain/backtest-engine";
import type { BacktestInput, PortfolioInput } from "@/types/backtest";

afterEach(() => {
  vi.resetModules();
  vi.doUnmock("@/services/create-report");
});

function portfolioInput(tickers: string[]): PortfolioInput {
  return {
    positions: tickers.map((ticker, index) => ({
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
}

describe("portfolio report orchestration", () => {
  it("calculates more than two holdings within the ten-holding product limit", async () => {
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
    const input = portfolioInput(["AAA", "BBB", "CCC"]);

    const report = await createPortfolioReport({ input, demo: true });

    assert.equal(report.holdings.length, 3);
    assert.equal(report.historical?.holdingsCount, 3);
  });

  it("rejects eleven holdings before starting any report request", async () => {
    const createReport = vi.fn();
    vi.doMock("@/services/create-report", () => ({ createReport }));
    const { createPortfolioReport } = await import("@/services/create-portfolio-report");
    const input = portfolioInput(Array.from({ length: 11 }, (_, index) => `T${index}`));

    await assert.rejects(() => createPortfolioReport({ input, demo: false }), /at most 10/i);
    assert.equal(createReport.mock.calls.length, 0);
  });

  it("rejects duplicate holdings before starting any report request", async () => {
    const createReport = vi.fn();
    vi.doMock("@/services/create-report", () => ({ createReport }));
    const { createPortfolioReport } = await import("@/services/create-portfolio-report");

    await assert.rejects(
      () => createPortfolioReport({ input: portfolioInput(["AAPL", " aapl "]), demo: false }),
      /unique/i,
    );
    assert.equal(createReport.mock.calls.length, 0);
  });
});
