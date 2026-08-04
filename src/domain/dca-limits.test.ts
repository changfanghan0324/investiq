import { describe, expect, it } from "vitest";

import {
  MAX_DCA_HOLDINGS,
  assertValidDcaHoldingSet,
  validateDcaHoldingSet,
} from "@/domain/dca-limits";

describe("DCA holding limits", () => {
  it("accepts one through ten unique normalized tickers", () => {
    expect(validateDcaHoldingSet([{ ticker: " aapl " }])).toBeUndefined();
    expect(validateDcaHoldingSet(
      Array.from({ length: MAX_DCA_HOLDINGS }, (_, index) => ({ ticker: `T${index}` })),
    )).toBeUndefined();
  });

  it("rejects an empty holding set", () => {
    expect(() => assertValidDcaHoldingSet([])).toThrow(/at least one/i);
  });

  it("rejects more than ten holdings", () => {
    const positions = Array.from({ length: MAX_DCA_HOLDINGS + 1 }, (_, index) => ({
      ticker: `T${index}`,
    }));
    expect(() => assertValidDcaHoldingSet(positions)).toThrow(/at most 10/i);
  });

  it("rejects case-insensitive duplicates and blank tickers", () => {
    expect(validateDcaHoldingSet([{ ticker: "AAPL" }, { ticker: " aapl " }])).toMatch(/unique/i);
    expect(validateDcaHoldingSet([{ ticker: "" }])).toMatch(/needs a ticker/i);
  });
});
