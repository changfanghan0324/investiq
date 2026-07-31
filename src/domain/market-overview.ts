// Purpose: Pure Market Overview helpers — trailing-window slicing, benchmark summaries,
// normalized chart series, watchlist rules, and the educational market-risk bands.
//
// Scope and conventions:
// - Only `close` is read, so every figure is a price return: dividends are excluded and
//   totals understate total return. Closes are expected to be split-adjusted.
// - Rates and drawdowns are decimal fractions (0.05 is +5%, -0.2 is a 20% drawdown).
//   Nothing here converts to percent, rounds for display, or formats.
// - Deterministic: no clock, no randomness, no I/O. The caller supplies the window start.
// - `undefined` means "not computable from this data", never zero.
// - Risk bands describe the observed window for teaching purposes. They are not a
//   recommendation, a forecast, or a signal.

import {
  annualizedVolatility,
  dailyCloseReturns,
  maxCloseDrawdown,
  validatePriceSeries,
} from '@/domain/analytics';
import type { ReturnBasis } from '@/domain/analytics';
import type { DateString, PriceBar } from '@/types/backtest';

/**
 * Investable ETF proxies in display order. These are funds that track index exposure —
 * they are not the indices themselves, and their returns differ from the index.
 */
export const BENCHMARK_SYMBOLS = ['SPY', 'QQQ', 'DIA'] as const;

export type BenchmarkSymbol = (typeof BENCHMARK_SYMBOLS)[number];

/** Hard ceiling on saved watchlist entries, enforced on add and on load. */
export const MAX_WATCHLIST_SYMBOLS = 10;

/** Matches the market-data route's own rule, so an invalid entry never reaches the network. */
const SYMBOL_PATTERN = /^[A-Z0-9.-]{1,12}$/;

// --- Trailing window summary -------------------------------------------------

export interface PriceWindowSummary {
  /** First trading date inside the window. */
  firstDate: DateString;
  /** Most recent trading date inside the window. */
  lastDate: DateString;
  barCount: number;
  /** Split-adjusted close on `lastDate`. */
  close: number;
  /** Close-to-close price return across the whole window; undefined with a single bar. */
  priceReturn?: number;
  /**
   * Vendor-adjusted total return across the window (a dividend-and-split proxy, not
   * audited dividend accounting). Present only when every bar in the window carries a
   * valid adjusted close; undefined otherwise, so price and total are never conflated.
   */
  totalReturn?: number;
  /**
   * Annualized volatility of daily closes; undefined below `MIN_RISK_OBSERVATIONS`
   * daily returns, so a statistically meaningless short-window figure is never shown.
   */
  volatility?: number;
  /** Worst close-to-close decline inside the window, as a non-positive fraction. */
  maxDrawdown: number;
}

/** Bars on or after `windowStart`, preserving order. */
export function trailingWindow(bars: PriceBar[], windowStart: DateString): PriceBar[] {
  return bars.filter((bar) => bar.date >= windowStart);
}

/**
 * Price-return, volatility, and drawdown figures for one already-sliced window.
 * Throws when the series cannot support return math.
 */
export function summarizePriceWindow(bars: PriceBar[]): PriceWindowSummary {
  validatePriceSeries(bars);

  const first = bars[0];
  const last = bars[bars.length - 1];
  // The window carries a total-return proxy only when every bar has a valid adjusted close.
  const covered = bars.every(
    (bar) => bar.adjustedClose !== undefined && Number.isFinite(bar.adjustedClose) && bar.adjustedClose > 0,
  );
  return {
    firstDate: first.date,
    lastDate: last.date,
    barCount: bars.length,
    close: last.close,
    priceReturn: bars.length < 2 ? undefined : last.close / first.close - 1,
    totalReturn:
      bars.length < 2 || !covered ? undefined : last.adjustedClose! / first.adjustedClose! - 1,
    volatility: bars.length < 2 ? undefined : annualizedVolatility(dailyCloseReturns(bars)),
    maxDrawdown: maxCloseDrawdown(bars).drawdown,
  };
}

/**
 * Whether a window carries complete adjusted-close coverage (a total-return proxy is
 * available). Used to resolve one shared basis across the symbols on the page.
 */
export function windowHasTotalReturn(bars: PriceBar[]): boolean {
  return (
    bars.length > 0 &&
    bars.every(
      (bar) => bar.adjustedClose !== undefined && Number.isFinite(bar.adjustedClose) && bar.adjustedClose > 0,
    )
  );
}

// --- Normalized comparison series -------------------------------------------

export interface NormalizedSeriesPoint {
  date: DateString;
  /** Cumulative price return per symbol; every symbol is 0 on the first shared date. */
  values: Record<string, number>;
}

/**
 * Cumulative return for every symbol, rebased to 0 on the first trading day that all of
 * them share, on ONE `basis`. Dates missing from any symbol are dropped, so a holiday or
 * a shorter listing history never pairs mismatched days on one axis. On the `total` basis
 * every bar must carry an adjusted close (a bar without one is skipped rather than mixed
 * with a raw close); the caller only selects `total` when every symbol is covered.
 */
export function buildNormalizedSeries(
  series: Array<{ symbol: string; bars: PriceBar[] }>,
  basis: ReturnBasis = 'price',
): NormalizedSeriesPoint[] {
  const usable = series
    .filter((entry) => entry.bars.length > 0)
    .map((entry) => ({
      symbol: entry.symbol,
      closes: new Map(
        entry.bars.flatMap((bar) => {
          const value = basis === 'total' ? bar.adjustedClose : bar.close;
          return value === undefined ? [] : [[bar.date, value] as [DateString, number]];
        }),
      ),
    }))
    .filter((entry) => entry.closes.size > 0);
  if (usable.length === 0) return [];

  const sharedDates = [...usable[0].closes.keys()]
    .filter((date) => usable.every((entry) => entry.closes.has(date)))
    .sort((left, right) => left.localeCompare(right));
  if (sharedDates.length === 0) return [];

  const bases = usable.map((entry) => ({
    symbol: entry.symbol,
    closes: entry.closes,
    baseClose: entry.closes.get(sharedDates[0]) ?? 0,
  }));

  return sharedDates.map((date) => {
    const values: Record<string, number> = {};
    for (const entry of bases) {
      const close = entry.closes.get(date);
      if (close === undefined || entry.baseClose <= 0) continue;
      values[entry.symbol] = close / entry.baseClose - 1;
    }
    return { date, values };
  });
}

// --- Watchlist rules ---------------------------------------------------------

export type WatchlistRejection = 'invalid' | 'duplicate' | 'full';

export interface WatchlistAddResult {
  /** The resulting list; unchanged when the entry was rejected. */
  symbols: string[];
  added?: string;
  rejected?: WatchlistRejection;
}

/** Trims surrounding whitespace and uppercases; no other characters are removed. */
export function normalizeSymbol(raw: string): string {
  return raw.trim().toUpperCase();
}

export function isValidSymbol(symbol: string): boolean {
  return SYMBOL_PATTERN.test(symbol);
}

/** Appends a normalized symbol, rejecting invalid, duplicate, and over-limit entries. */
export function addWatchlistSymbol(symbols: string[], raw: string): WatchlistAddResult {
  const symbol = normalizeSymbol(raw);
  if (!isValidSymbol(symbol)) return { symbols, rejected: 'invalid' };
  if (symbols.includes(symbol)) return { symbols, rejected: 'duplicate' };
  if (symbols.length >= MAX_WATCHLIST_SYMBOLS) return { symbols, rejected: 'full' };
  return { symbols: [...symbols, symbol], added: symbol };
}

export function removeWatchlistSymbol(symbols: string[], raw: string): string[] {
  const symbol = normalizeSymbol(raw);
  return symbols.filter((entry) => entry !== symbol);
}

/**
 * Reads the persisted watchlist defensively. Only ticker symbols are ever stored, so
 * anything else in the slot — malformed JSON, objects, invalid or duplicate tickers,
 * entries past the limit — is discarded rather than trusted.
 */
export function parseStoredWatchlist(raw: string | null): string[] {
  if (!raw) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const symbols: string[] = [];
  for (const entry of parsed) {
    if (typeof entry !== 'string') continue;
    const symbol = normalizeSymbol(entry);
    if (!isValidSymbol(symbol) || symbols.includes(symbol)) continue;
    symbols.push(symbol);
    if (symbols.length === MAX_WATCHLIST_SYMBOLS) break;
  }
  return symbols;
}

// --- Educational risk bands --------------------------------------------------

/** Upper bounds, exclusive, for each annualized-volatility band. */
export const VOLATILITY_BAND_LIMITS = { calm: 0.12, normal: 0.2, elevated: 0.3 } as const;

/** Lower bounds, exclusive, for each drawdown band; deeper than `deep` is severe. */
export const DRAWDOWN_BAND_LIMITS = { shallow: -0.05, moderate: -0.1, deep: -0.2 } as const;

export type VolatilityBand = 'calm' | 'normal' | 'elevated' | 'stressed';
export type DrawdownBand = 'shallow' | 'moderate' | 'deep' | 'severe';

export function classifyVolatility(annualized: number): VolatilityBand {
  if (annualized < VOLATILITY_BAND_LIMITS.calm) return 'calm';
  if (annualized < VOLATILITY_BAND_LIMITS.normal) return 'normal';
  if (annualized < VOLATILITY_BAND_LIMITS.elevated) return 'elevated';
  return 'stressed';
}

export function classifyDrawdown(drawdown: number): DrawdownBand {
  if (drawdown > DRAWDOWN_BAND_LIMITS.shallow) return 'shallow';
  if (drawdown > DRAWDOWN_BAND_LIMITS.moderate) return 'moderate';
  if (drawdown > DRAWDOWN_BAND_LIMITS.deep) return 'deep';
  return 'severe';
}

export interface MarketRiskSummary {
  volatilityBand: VolatilityBand;
  /** Highest annualized volatility observed across the benchmarks that loaded. */
  volatility: number;
  volatilitySymbol: string;
  drawdownBand: DrawdownBand;
  /** Deepest maximum close-to-close drawdown observed across those benchmarks. */
  drawdown: number;
  drawdownSymbol: string;
}

/**
 * Describes the window using the widest-moving benchmark that loaded, so a single calm
 * benchmark cannot mask stress elsewhere. Returns undefined when no benchmark supplied a
 * volatility figure, because a band with no basis would be an invented reading.
 */
export function deriveMarketRisk(
  benchmarks: Array<{ symbol: string; summary: PriceWindowSummary }>,
): MarketRiskSummary | undefined {
  let volatilityLeader: { symbol: string; value: number } | undefined;
  let drawdownLeader: { symbol: string; value: number } | undefined;

  for (const { symbol, summary } of benchmarks) {
    const { volatility, maxDrawdown } = summary;
    if (volatility !== undefined && (!volatilityLeader || volatility > volatilityLeader.value)) {
      volatilityLeader = { symbol, value: volatility };
    }
    if (!drawdownLeader || maxDrawdown < drawdownLeader.value) {
      drawdownLeader = { symbol, value: maxDrawdown };
    }
  }

  if (!volatilityLeader || !drawdownLeader) return undefined;
  return {
    volatilityBand: classifyVolatility(volatilityLeader.value),
    volatility: volatilityLeader.value,
    volatilitySymbol: volatilityLeader.symbol,
    drawdownBand: classifyDrawdown(drawdownLeader.value),
    drawdown: drawdownLeader.value,
    drawdownSymbol: drawdownLeader.symbol,
  };
}
