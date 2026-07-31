// Purpose: Versioned, auditable, broker-specific fee engine plus the deterministic
// decimal helpers shared by contribution, dividend, and sale orders.
//
// Model boundary (educational counterfactual DCA, not brokerage bookkeeping):
// - Every preset is a dated, source-backed fee SCENARIO. Reliable historical broker
//   schedules do not exist for every simulated date, so the selected current schedule
//   is applied to every modeled order. The app never reconstructs historical charges.
// - The user's universal 0.001-share flooring rule is authoritative. Real broker
//   minimum order values, symbol eligibility, fractional precision, routing, spread,
//   slippage, and fill rules vary and are NOT enforced.
// - One modeled order is treated as one execution. Real partial fills can split an
//   order and change per-execution minimums and caps, so a quote is not an exact
//   broker statement.
// - Where an official page does not state a rounding rule, the convention is
//   documented here rather than presented as verified.

import type {
  FeeComponent,
  FeeComponentKind,
  FeeConfig,
  FeeRule,
  OrderContext,
  OrderPurpose,
  FeeBreakdown,
} from '@/types/backtest';

/**
 * Raised when a fee configuration cannot be priced — for example a `kind: 'preset'`
 * config whose broker id has no versioned schedule. The engine fails closed rather
 * than silently charging $0 or falling back to generic custom rules, either of
 * which would understate cost.
 */
export class FeeConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FeeConfigError';
  }
}

// --- Regulatory schedules (versioned, primary-source-backed) ----------------

/**
 * SEC Section 31 transaction fee on the SELL side only. FY2026 advisory sets the
 * rate at $20.60 per $1,000,000 of principal, effective 2026-04-04.
 * Source: https://www.sec.gov/rules-regulations/fee-rate-advisories/2026-2
 */
export const SEC_SECTION_31 = Object.freeze({
  version: 'SEC-31-FY2026',
  effectiveDate: '2026-04-04',
  ratePerDollar: 20.6 / 1_000_000, // 0.0000206
  source: 'https://www.sec.gov/rules-regulations/fee-rate-advisories/2026-2',
});

/**
 * FINRA Trading Activity Fee (TAF) on the SELL side only. 2026 rate is
 * $0.000195 per share, capped at $9.79 per trade, effective 2026-01-01. FINRA
 * does not assess the TAF when the execution price is below the per-share rate.
 * Source: https://www.finra.org/rules-guidance/rule-filings/sr-finra-2024-019/fee-adjustment-schedule
 */
export const FINRA_TAF = Object.freeze({
  version: 'FINRA-TAF-2026',
  effectiveDate: '2026-01-01',
  perShare: 0.000195,
  maxDollars: 9.79,
  source:
    'https://www.finra.org/rules-guidance/rule-filings/sr-finra-2024-019/fee-adjustment-schedule',
});

/**
 * Consolidated Audit Trail (CAT) NMS pass-through, assessed by some brokers on
 * both buy and sell executions at $0.000003 per share. Rounding to the cent is a
 * documented model convention: the official pages do not state one.
 */
export const CAT_FEE = Object.freeze({
  version: 'CAT-2026',
  perShare: 0.000003,
});

// --- Decimal / cent helpers -------------------------------------------------

/** UI/broker/regulatory currency precision: nearest whole cent. */
export function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Rounds a positive dollar amount UP to the next whole cent, tolerating the
 * floating-point noise that would otherwise push an exact-cent value up a penny.
 */
export function ceilMoney(value: number): number {
  if (value <= 0) return 0;
  return Math.ceil(value * 100 - 1e-6) / 100;
}

/**
 * Internal calculation-money precision. Share principal, residual cash, NAV,
 * basis, and tax arithmetic round here instead of to cents, so a positive
 * fractional order at a positive price can never collapse to a zero principal.
 * UI currency formatting still renders at 2 decimals, and per-component fee
 * rounding stays at whole cents.
 */
export const CALC_MONEY_DECIMALS = 6;
const CALC_MONEY_SCALE = 10 ** CALC_MONEY_DECIMALS;

export function roundCalcMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * CALC_MONEY_SCALE) / CALC_MONEY_SCALE;
}

export function floorShares(value: number): number {
  return Math.floor(Math.max(0, value) * 1_000 + 1e-9) / 1_000;
}

/**
 * Split-adjusted share principal at calculation precision. A positive share
 * quantity at a positive price always yields a positive principal: if six-decimal
 * rounding would underflow to zero, the exact product is used instead so no share
 * position is ever created for zero cost.
 */
export function sharePrincipal(shares: number, price: number): number {
  if (shares <= 0 || price <= 0) return 0;
  const rounded = roundCalcMoney(shares * price);
  return rounded > 0 ? rounded : shares * price;
}

// --- Fee components ----------------------------------------------------------

/** Canonical display order for aggregated component breakdowns. */
export const FEE_COMPONENT_ORDER: FeeComponentKind[] = [
  'commission',
  'platform',
  'settlement',
  'sec-31',
  'finra-taf',
  'cat',
  'custom',
];

type MaybeComponent = FeeComponent | null;

function component(kind: FeeComponentKind, amount: number): MaybeComponent {
  return amount > 0 ? { kind, amount } : null;
}

/** A dollar amount rounded UP or to the nearest cent, per the source convention. */
type Rounding = 'up' | 'nearest';

function roundBy(mode: Rounding, value: number): number {
  return mode === 'up' ? ceilMoney(value) : roundMoney(value);
}

/**
 * SEC Section 31 sell fee. `waiveAtOrBelowNotional` models a broker that does not
 * pass the fee through on small sales (Robinhood: notional ≤ $500). `minDollars`
 * models a broker per-trade floor (Moomoo: $0.01).
 */
function secSell(
  value: number,
  opts: { round: Rounding; minDollars?: number; waiveAtOrBelowNotional?: number },
): MaybeComponent {
  if (opts.waiveAtOrBelowNotional !== undefined && value <= opts.waiveAtOrBelowNotional) return null;
  let amount = roundBy(opts.round, value * SEC_SECTION_31.ratePerDollar);
  if (opts.minDollars !== undefined) amount = Math.max(amount, opts.minDollars);
  return component('sec-31', amount);
}

/**
 * FINRA TAF sell fee. Not assessed when the execution price is below the per-share
 * rate (FINRA price-below-rate exemption) or when the broker waives it for small
 * quantities (Robinhood: ≤ 50 shares). The $9.79 cap binds before and after
 * rounding.
 */
function tafSell(
  shares: number,
  price: number,
  opts: { round: Rounding; minDollars?: number; waiveAtOrBelowShares?: number },
): MaybeComponent {
  if (price < FINRA_TAF.perShare) return null;
  if (opts.waiveAtOrBelowShares !== undefined && shares <= opts.waiveAtOrBelowShares) return null;
  const raw = Math.min(shares * FINRA_TAF.perShare, FINRA_TAF.maxDollars);
  let amount = roundBy(opts.round, raw);
  if (opts.minDollars !== undefined) amount = Math.max(amount, opts.minDollars);
  amount = Math.min(amount, FINRA_TAF.maxDollars);
  return component('finra-taf', amount);
}

/** CAT NMS pass-through on the given side; rounded to the cent (model convention). */
function catBothSides(shares: number): MaybeComponent {
  return component('cat', roundMoney(shares * CAT_FEE.perShare));
}

function compact(parts: MaybeComponent[]): FeeComponent[] {
  return parts.filter((part): part is FeeComponent => part !== null && part.amount > 0);
}

/**
 * Merges component lines by kind into one canonical-ordered breakdown, dropping
 * any kind whose total rounded to zero. Used to summarize a run's whole fee bill.
 */
export function aggregateFeeComponents(components: FeeComponent[]): FeeComponent[] {
  const totals = new Map<FeeComponentKind, number>();
  for (const line of components) {
    totals.set(line.kind, roundMoney((totals.get(line.kind) ?? 0) + line.amount));
  }
  return FEE_COMPONENT_ORDER.filter((kind) => (totals.get(kind) ?? 0) > 0).map((kind) => ({
    kind,
    amount: totals.get(kind)!,
  }));
}

// --- Broker commission helpers ----------------------------------------------

/**
 * A share-quantity order counts as a whole-share lot only when the floored share
 * count is an integer. Cash/notional contributions and dividend reinvestments are
 * always treated as fractional/notional so the cash-sizing solver stays
 * well-defined; an aggregate liquidation uses whichever its total share count is.
 */
function isWholeShareLot(ctx: OrderContext): boolean {
  if (ctx.purpose === 'contribution-cash' || ctx.purpose === 'dividend-reinvestment') return false;
  return Number.isInteger(ctx.shares);
}

/**
 * IBKR Fixed pricing commission. Whole-share lots pay $0.005/share with a $1
 * minimum, capped at 1% of trade value (so the cap can pull the charge below the
 * $1 minimum). Fractional/notional orders pay the greater of 1% of value or
 * $0.01, per IBKR's published fractional rule.
 */
function ibkrFixedCommission(ctx: OrderContext): MaybeComponent {
  if (isWholeShareLot(ctx)) {
    const perShare = Math.max(0.005 * ctx.shares, 1);
    return component('commission', roundMoney(Math.min(perShare, 0.01 * ctx.tradeValue)));
  }
  return component('commission', roundMoney(Math.max(0.01 * ctx.tradeValue, 0.01)));
}

/**
 * IBKR Pro Tiered BASE first-tier commission only: $0.0035/share, $0.35 minimum,
 * 1% of trade-value cap. Venue, exchange, clearing, liquidity, and monthly-volume
 * effects are not knowable from these inputs and are excluded — this is a base
 * commission estimate, never an exact total cost.
 */
function ibkrTieredCommission(ctx: OrderContext): MaybeComponent {
  const perShare = Math.max(0.0035 * ctx.shares, 0.35);
  return component('commission', roundMoney(Math.min(perShare, 0.01 * ctx.tradeValue)));
}

/** IBKR dividend-reinvestment commission: the lesser of $1 or 0.1% of value. */
function ibkrDripCommission(value: number): MaybeComponent {
  return component('commission', roundMoney(Math.min(1, 0.001 * value)));
}

// --- Broker schedules (registry) --------------------------------------------
//
// Each schedule returns the ordered, per-component charges for one order. Purpose
// and side select the branch. Dividend reinvestment follows a per-broker DRIP
// scenario. Custom is handled separately and never receives regulatory charges.

type Schedule = (ctx: OrderContext) => FeeComponent[];

const BROKER_SCHEDULES: Record<string, Schedule> = {
  // $0 online equity commission. Sell picks up SEC (rounded up, waived ≤ $500) and
  // FINRA TAF (waived ≤ 50 shares, price-below-rate exemption). No CAT since
  // 2025-12-01. DRIP is free.
  robinhood: (ctx) => {
    if (ctx.side === 'sell') {
      return compact([
        secSell(ctx.tradeValue, { round: 'up', waiveAtOrBelowNotional: 500 }),
        tafSell(ctx.shares, ctx.price, { round: 'nearest', waiveAtOrBelowShares: 50 }),
      ]);
    }
    return [];
  },

  // $0 commission. CAT on every execution (both sides). Sell adds SEC and TAF
  // (min $0.01, cap $9.79, price-below-rate exemption).
  webull: (ctx) => {
    if (ctx.side === 'sell') {
      return compact([
        secSell(ctx.tradeValue, { round: 'nearest' }),
        tafSell(ctx.shares, ctx.price, { round: 'nearest', minDollars: 0.01 }),
        catBothSides(ctx.shares),
      ]);
    }
    return compact([catBothSides(ctx.shares)]);
  },

  // US resident: $0 commission and $0 promotional platform fee. CAT both sides.
  // Sell adds SEC (min $0.01) and TAF (min $0.01). DRIP is a $0 scenario.
  'moomoo-us': (ctx) => {
    if (ctx.purpose === 'dividend-reinvestment') return [];
    if (ctx.side === 'sell') {
      return compact([
        secSell(ctx.tradeValue, { round: 'nearest', minDollars: 0.01 }),
        tafSell(ctx.shares, ctx.price, { round: 'nearest', minDollars: 0.01 }),
        catBothSides(ctx.shares),
      ]);
    }
    return compact([catBothSides(ctx.shares)]);
  },

  // Non-US resident, fixed platform plan. Quantity < 1 share: platform 0.99% of
  // value, cap $0.99, rounded up, regulatory fees waived. Quantity ≥ 1 share:
  // platform $0.005/share (min $1/order) + settlement $0.003/share + CAT, and on
  // the sell side SEC (min $0.01) and TAF (min $0.01). DRIP is a $0 scenario.
  'moomoo-non-us': (ctx) => {
    if (ctx.purpose === 'dividend-reinvestment') return [];
    if (ctx.shares < 1) {
      return compact([component('platform', ceilMoney(Math.min(0.0099 * ctx.tradeValue, 0.99)))]);
    }
    const platform = component('platform', roundMoney(Math.max(0.005 * ctx.shares, 1)));
    const settlement = component('settlement', roundMoney(0.003 * ctx.shares));
    if (ctx.side === 'sell') {
      return compact([
        platform,
        settlement,
        secSell(ctx.tradeValue, { round: 'nearest', minDollars: 0.01 }),
        tafSell(ctx.shares, ctx.price, { round: 'nearest', minDollars: 0.01 }),
        catBothSides(ctx.shares),
      ]);
    }
    return compact([platform, settlement, catBothSides(ctx.shares)]);
  },

  // $0 equity commission. Sell passes through SEC only — no TAF (Firstrade's page
  // does not document a customer TAF charge) and no CAT. ADR custody fees are
  // security-specific and excluded. DRIP is free.
  firstrade: (ctx) => {
    if (ctx.side === 'sell') return compact([secSell(ctx.tradeValue, { round: 'nearest' })]);
    return [];
  },

  // Recurring-investment instructions use Fixed pricing. A normal exchange-listed
  // end liquidation is commission-free but still carries regulatory sell fees.
  // DRIP commission is the lesser of $1 or 0.1% of value.
  'ibkr-lite': (ctx) => {
    if (ctx.purpose === 'dividend-reinvestment') return compact([ibkrDripCommission(ctx.tradeValue)]);
    if (ctx.side === 'sell') {
      return compact([
        secSell(ctx.tradeValue, { round: 'nearest' }),
        tafSell(ctx.shares, ctx.price, { round: 'nearest' }),
      ]);
    }
    return compact([ibkrFixedCommission(ctx)]);
  },

  // Fixed pricing on both sides plus regulatory sell fees. DRIP as for Lite.
  'ibkr-pro-fixed': (ctx) => {
    if (ctx.purpose === 'dividend-reinvestment') return compact([ibkrDripCommission(ctx.tradeValue)]);
    if (ctx.side === 'sell') {
      return compact([
        ibkrFixedCommission(ctx),
        secSell(ctx.tradeValue, { round: 'nearest' }),
        tafSell(ctx.shares, ctx.price, { round: 'nearest' }),
      ]);
    }
    return compact([ibkrFixedCommission(ctx)]);
  },

  // Base first-tier commission estimate only; third-party/venue costs excluded.
  'ibkr-pro-tiered': (ctx) => {
    if (ctx.purpose === 'dividend-reinvestment') return compact([ibkrDripCommission(ctx.tradeValue)]);
    if (ctx.side === 'sell') {
      return compact([
        ibkrTieredCommission(ctx),
        secSell(ctx.tradeValue, { round: 'nearest' }),
        tafSell(ctx.shares, ctx.price, { round: 'nearest' }),
      ]);
    }
    return compact([ibkrTieredCommission(ctx)]);
  },
};

/** Broker ids whose schedules the engine can price. */
export const SUPPORTED_BROKER_SCHEDULES = Object.keys(BROKER_SCHEDULES);

// --- Custom (generic) schedule ----------------------------------------------

function customRuleFor(fees: FeeConfig, purpose: OrderPurpose): FeeRule {
  if (purpose === 'liquidation') return fees.sell;
  if (purpose === 'dividend-reinvestment') return fees.dividendReinvestment;
  return fees.buy;
}

/**
 * The generic custom scenario: one fixed + per-share + percent-of-value charge
 * with an optional minimum and maximum. It never receives hidden SEC/TAF/CAT
 * charges — a custom plan is exactly what the user typed.
 */
function customComponents(fees: FeeConfig, ctx: OrderContext): FeeComponent[] {
  const rule = customRuleFor(fees, ctx.purpose);
  let amount = rule.fixed + rule.perShare * ctx.shares + (rule.percentOfValue / 100) * ctx.tradeValue;
  if (rule.minimum > 0) amount = Math.max(amount, rule.minimum);
  if (rule.maximum !== undefined && rule.maximum > 0) amount = Math.min(amount, rule.maximum);
  return compact([component('custom', roundMoney(amount))]);
}

// --- Public quote API -------------------------------------------------------

/**
 * Prices one order into an auditable component breakdown plus a cent total.
 * Preset schedules are looked up by broker id; a custom config uses the generic
 * rules. An unknown preset id throws {@link FeeConfigError} rather than falling
 * back to generic rules or silently charging nothing.
 */
export function quoteOrderFee(fees: FeeConfig, ctx: OrderContext): FeeBreakdown {
  // Resolve (and validate) the schedule before short-circuiting a degenerate order,
  // so an unknown preset id fails closed even on a zero-size quote.
  const schedule = resolveSchedule(fees);
  if (ctx.shares <= 0 || ctx.tradeValue <= 0) return { components: [], total: 0 };
  const components = schedule(ctx);
  const total = roundMoney(components.reduce((sum, line) => sum + line.amount, 0));
  return { components, total };
}

/**
 * Returns the pricing schedule for a fee config. A custom config is priced from
 * its editable generic rules regardless of how its id or name was renamed. A
 * preset config must map to a known versioned schedule; an unknown id throws
 * rather than silently charging $0.
 */
function resolveSchedule(fees: FeeConfig): Schedule {
  if (fees.kind === 'custom') return (ctx) => customComponents(fees, ctx);
  const schedule = BROKER_SCHEDULES[fees.brokerId];
  if (!schedule) {
    throw new FeeConfigError(
      `Unknown broker preset "${fees.brokerId}". A preset fee scenario must map to a versioned schedule; ` +
        `switch the plan to "custom" to enter fees manually.`,
    );
  }
  return schedule;
}

/** The cent total of {@link quoteOrderFee}; used by the cash-sizing solver. */
export function orderFeeTotal(fees: FeeConfig, ctx: OrderContext): number {
  return quoteOrderFee(fees, ctx).total;
}

// --- Cash-order solver ------------------------------------------------------

export interface CashOrder {
  shares: number;
  fee: number;
  cost: number;
  components: FeeComponent[];
}

/**
 * Solves for the largest 0.001-share buy whose principal plus fee still fits the
 * cash on hand, for a contribution cash order or a dividend reinvestment.
 *
 * Working in whole 0.001-share ticks turns this into an integer search. The
 * affordability quantity cost + fee is monotone non-decreasing in the tick count:
 * principal grows with size; every broker branch here — per-share, percent, fixed,
 * settlement, and CAT charges, and the SEC/TAF/platform components — is itself
 * non-decreasing, and the minimum floor, the FINRA-TAF and platform caps, and the
 * discontinuous jump at a broker threshold (a small-order exemption ending, or the
 * moomoo <1-share branch giving way to a per-share minimum) can only hold or raise
 * the total as size grows. A monotone predicate lets a bounded binary search land
 * on the exact maximal affordable tick in O(log ticks) evaluations, so it never
 * oscillates, never walks ticks one at a time, and never overspends the budget.
 */
export function sharesForCash(
  cash: number,
  price: number,
  fees: FeeConfig,
  purpose: 'contribution-cash' | 'dividend-reinvestment',
): CashOrder {
  const ZERO: CashOrder = { shares: 0, fee: 0, cost: 0, components: [] };

  // Reject non-positive and non-finite inputs before any division so the tick
  // search only ever runs on a well-defined, bounded problem.
  if (!Number.isFinite(cash) || !Number.isFinite(price) || cash <= 0 || price <= 0) return ZERO;

  const orderAt = (ticks: number): CashOrder | null => {
    if (ticks <= 0) return null;
    const shares = ticks / 1_000;
    const cost = sharePrincipal(shares, price);
    const breakdown = quoteOrderFee(fees, { purpose, side: 'buy', shares, tradeValue: cost, price });
    return cost + breakdown.total <= cash
      ? { shares, fee: breakdown.total, cost, components: breakdown.components }
      : null;
  };
  const affordable = (ticks: number): boolean => orderAt(ticks) !== null;

  // cash / price is the zero-fee principal ceiling, but sharePrincipal rounds to six
  // decimals, so a handful of ticks past that estimate can still round their cost
  // back down to an affordable value. That makes floor(cash/price*1000)+1 an unproven
  // upper bound. Instead, seed a finite integer just past the estimate, then expand
  // the ceiling geometrically until a tick is provably unaffordable, so the binary
  // search interval is guaranteed to contain the true maximum. All arithmetic stays
  // inside the safe-integer range; a combination whose true bound cannot be
  // represented there fails deterministically to a zero order rather than hanging.
  const MAX_TICKS = Number.MAX_SAFE_INTEGER;
  const seed = (cash / price) * 1_000;
  if (!Number.isFinite(seed) || seed >= MAX_TICKS) return ZERO;

  let high = Math.floor(seed) + 2;
  if (!Number.isSafeInteger(high) || high <= 0) return ZERO;
  while (affordable(high)) {
    if (high >= MAX_TICKS) return ZERO; // no representable unaffordable ceiling
    high = Math.min(high * 2, MAX_TICKS);
  }

  // Invariant: high is unaffordable and monotonicity makes every tick above it
  // unaffordable too, so the last affordable tick lies in [0, high]. The midpoint is
  // computed as low + (high - low) / 2 to avoid overflowing the safe-integer range.
  let low = 0;
  let best = ZERO;
  while (low <= high) {
    const mid = low + Math.floor((high - low) / 2);
    const order = orderAt(mid);
    if (order) {
      best = order;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return best;
}
