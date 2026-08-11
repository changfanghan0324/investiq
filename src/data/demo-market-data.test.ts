import { describe, expect, it } from "vitest";

import { createDemoMarketData } from "@/data/demo-market-data";

describe("synthetic market-data contract", () => {
  it("marks every generated series as synthetic and carries a disclosure", () => {
    const data = createDemoMarketData("SPY", 1);

    expect(data.source).toBe("demo");
    expect(data.provenance.sourceType).toBe("synthetic");
    expect(data.provenance.provider).toBe("InvestIQ deterministic demo generator");
    expect(data.provenance.generatedAt).toEqual(expect.any(String));
    expect(Number.isNaN(Date.parse(data.provenance.generatedAt))).toBe(false);
    expect(data.provenance.disclaimer).toBe(
      "This page uses synthetic market series for demonstration. It does not represent actual historical prices or investment performance.",
    );
  });
});
