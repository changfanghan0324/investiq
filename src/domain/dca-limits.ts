// Purpose: One shared product rule for DCA portfolio size and ticker uniqueness.

export const MIN_DCA_HOLDINGS = 1;
export const MAX_DCA_HOLDINGS = 10;

export interface DcaHoldingIdentity {
  ticker: string;
}

export function validateDcaHoldingSet(
  positions: readonly DcaHoldingIdentity[],
): string | undefined {
  if (positions.length < MIN_DCA_HOLDINGS) {
    return "Add at least one holding before running the backtest.";
  }
  if (positions.length > MAX_DCA_HOLDINGS) {
    return `DCA portfolios support at most ${MAX_DCA_HOLDINGS} holdings.`;
  }

  const normalized = positions.map((position) => position.ticker.trim().toUpperCase());
  if (normalized.some((ticker) => ticker.length === 0)) {
    return "Every DCA holding needs a ticker.";
  }
  if (new Set(normalized).size !== normalized.length) {
    return "DCA portfolio tickers must be unique.";
  }
  return undefined;
}

export function assertValidDcaHoldingSet(
  positions: readonly DcaHoldingIdentity[],
): void {
  const error = validateDcaHoldingSet(positions);
  if (error) throw new Error(error);
}
