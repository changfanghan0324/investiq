// Purpose: Shared economic-validity check for a single OHLC price bar.

export interface OhlcValues {
  open: number;
  high: number;
  low: number;
  close: number;
}

/**
 * A bar is economically valid only when every price is finite and strictly
 * positive, the high is at least the maximum of the other prices, and the low
 * is at most the minimum of the other prices.
 *
 * Rejecting anything else keeps the backtest away from zero- or negative-cost
 * fixed-share purchases and physically impossible intraday ranges. Both the
 * Yahoo parser and the domain input boundary reuse this predicate so the two
 * enforcement points can never drift apart.
 */
export function isValidOhlcBar(values: OhlcValues): boolean {
  const { open, high, low, close } = values;
  const prices = [open, high, low, close];
  if (!prices.every((price) => typeof price === 'number' && Number.isFinite(price) && price > 0)) {
    return false;
  }
  if (high < Math.max(open, close, low)) return false;
  if (low > Math.min(open, close, high)) return false;
  return true;
}
