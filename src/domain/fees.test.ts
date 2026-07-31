import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { brokerPresets, getBrokerPreset } from '@/constants/broker-presets';
import {
  FeeConfigError,
  orderFeeTotal,
  quoteOrderFee,
  sharePrincipal,
  sharesForCash,
} from '@/domain/fees';
import type { FeeComponentKind, FeeConfig, FeeRule, OrderContext } from '@/types/backtest';

// --- Order-context builders --------------------------------------------------

function sell(shares: number, value: number): OrderContext {
  return { purpose: 'liquidation', side: 'sell', shares, tradeValue: value, price: value / shares };
}
function buyShares(shares: number, value: number): OrderContext {
  return { purpose: 'contribution-shares', side: 'buy', shares, tradeValue: value, price: value / shares };
}
function buyCash(shares: number, value: number): OrderContext {
  return { purpose: 'contribution-cash', side: 'buy', shares, tradeValue: value, price: value / shares };
}
function drip(shares: number, value: number): OrderContext {
  return { purpose: 'dividend-reinvestment', side: 'buy', shares, tradeValue: value, price: value / shares };
}

function amountOf(fees: FeeConfig, ctx: OrderContext, kind: FeeComponentKind): number {
  return quoteOrderFee(fees, ctx).components.find((line) => line.kind === kind)?.amount ?? 0;
}
function kinds(fees: FeeConfig, ctx: OrderContext): FeeComponentKind[] {
  return quoteOrderFee(fees, ctx).components.map((line) => line.kind);
}

const preset = (id: string) => getBrokerPreset(id);

function customFees(rules?: {
  buy?: Partial<FeeRule>;
  sell?: Partial<FeeRule>;
  dividendReinvestment?: Partial<FeeRule>;
}): FeeConfig {
  const base = getBrokerPreset('custom');
  return {
    ...base,
    buy: { ...base.buy, ...rules?.buy },
    sell: { ...base.sell, ...rules?.sell },
    dividendReinvestment: { ...base.dividendReinvestment, ...rules?.dividendReinvestment },
  };
}

// --- Robinhood ---------------------------------------------------------------

describe('Robinhood fee schedule', () => {
  const rh = preset('robinhood');

  it('charges $20.60 SEC plus the capped $9.79 TAF on a $1m / 100k-share sale', () => {
    // SEC: ceil($1,000,000 × 0.0000206) = $20.60. TAF: min(100,000 × $0.000195, $9.79) = $9.79.
    assert.equal(orderFeeTotal(rh, sell(100_000, 1_000_000)), 30.39);
    assert.equal(amountOf(rh, sell(100_000, 1_000_000), 'sec-31'), 20.6);
    assert.equal(amountOf(rh, sell(100_000, 1_000_000), 'finra-taf'), 9.79);
  });

  it('waives the SEC fee at a $500 notional and the TAF at 50 shares', () => {
    assert.equal(orderFeeTotal(rh, sell(40, 500)), 0);
    assert.deepEqual(kinds(rh, sell(50, 1_000)), ['sec-31']); // TAF waived ≤ 50 shares
    assert.equal(amountOf(rh, sell(50, 1_000), 'sec-31'), 0.03); // ceil($1,000 × 0.0000206) = $0.03
  });

  it('assesses both fees immediately above the exemption boundaries', () => {
    // Just above $500 notional the SEC fee is no longer waived.
    assert.equal(amountOf(rh, sell(40, 501), 'sec-31'), 0.02);
    assert.equal(amountOf(rh, sell(40, 501), 'finra-taf'), 0); // still ≤ 50 shares
    // Just above 50 shares the TAF is assessed (rounded to the cent).
    assert.equal(amountOf(rh, sell(51, 1_000), 'finra-taf'), 0.01);
  });

  it('charges nothing on buys or dividend reinvestment (no CAT since 2025-12-01)', () => {
    assert.equal(orderFeeTotal(rh, buyCash(10, 1_000)), 0);
    assert.equal(orderFeeTotal(rh, drip(10, 1_000)), 0);
  });
});

// --- Webull ------------------------------------------------------------------

describe('Webull fee schedule', () => {
  const webull = preset('webull');

  it('applies the CAT pass-through on both buy and sell', () => {
    assert.equal(amountOf(webull, buyShares(200_000, 2_000_000), 'cat'), 0.6);
    assert.equal(amountOf(webull, sell(200_000, 2_000_000), 'cat'), 0.6);
  });

  it('floors the TAF at $0.01 on a small sale and adds SEC', () => {
    // TAF raw 10 × $0.000195 = $0.00195 → rounds to $0.00, floored to the $0.01 minimum.
    assert.equal(amountOf(webull, sell(10, 1_000), 'finra-taf'), 0.01);
    assert.equal(amountOf(webull, sell(10, 1_000), 'sec-31'), 0.02);
  });
});

// --- Moomoo US resident ------------------------------------------------------

describe('Moomoo (US resident) fee schedule', () => {
  const moomoo = preset('moomoo-us');

  it('floors SEC and TAF at $0.01 each and keeps CAT on both sides', () => {
    assert.equal(amountOf(moomoo, sell(10, 100), 'sec-31'), 0.01);
    assert.equal(amountOf(moomoo, sell(10, 100), 'finra-taf'), 0.01);
    assert.equal(amountOf(moomoo, buyShares(200_000, 2_000_000), 'cat'), 0.6);
    assert.equal(amountOf(moomoo, sell(200_000, 2_000_000), 'cat'), 0.6);
  });

  it('uses a $0 dividend-reinvestment scenario', () => {
    assert.equal(orderFeeTotal(moomoo, drip(10, 1_000)), 0);
  });
});

// --- Moomoo non-US resident --------------------------------------------------

describe('Moomoo (non-US resident) fee schedule', () => {
  const moomoo = preset('moomoo-non-us');

  it('charges a rounded-up 0.99% platform fee and waives regulatory fees below 1 share', () => {
    assert.deepEqual(kinds(moomoo, buyCash(0.5, 50)), ['platform']);
    assert.equal(amountOf(moomoo, buyCash(0.5, 50), 'platform'), 0.5); // ceil(0.99% × $50) = $0.50
    // The 0.99% platform fee is capped at $0.99.
    assert.equal(amountOf(moomoo, buyCash(0.5, 500), 'platform'), 0.99);
    // Regulatory fees are waived below one share, even on a sell.
    assert.deepEqual(kinds(moomoo, sell(0.5, 50)), ['platform']);
  });

  it('switches to per-share platform, settlement, and regulatory fees at 1 share', () => {
    // Buy ≥ 1 share: platform max($0.005×10, $1) = $1, settlement $0.003×10 = $0.03, CAT ~$0.
    assert.deepEqual(kinds(moomoo, buyShares(10, 1_000)), ['platform', 'settlement']);
    assert.equal(orderFeeTotal(moomoo, buyShares(10, 1_000)), 1.03);
    // Sell ≥ 1 share adds SEC (min $0.01) and TAF (min $0.01).
    assert.equal(orderFeeTotal(moomoo, sell(10, 1_000)), 1.06);
  });
});

// --- Firstrade ---------------------------------------------------------------

describe('Firstrade fee schedule', () => {
  const firstrade = preset('firstrade');

  it('passes through SEC on sells but never an undocumented TAF', () => {
    assert.deepEqual(kinds(firstrade, sell(100, 10_000)), ['sec-31']);
    assert.equal(amountOf(firstrade, sell(100, 10_000), 'sec-31'), 0.21);
    assert.equal(amountOf(firstrade, sell(100, 10_000), 'finra-taf'), 0);
  });

  it('reinvests dividends for free', () => {
    assert.equal(orderFeeTotal(firstrade, drip(5, 500)), 0);
  });
});

// --- IBKR --------------------------------------------------------------------

describe('IBKR fee schedules', () => {
  it('caps the $1 whole-share minimum at 1% of a $20 trade', () => {
    // Fixed whole-share: max($0.005×2, $1) = $1, capped at 1% × $20 = $0.20.
    assert.equal(orderFeeTotal(preset('ibkr-pro-fixed'), buyShares(2, 20)), 0.2);
  });

  it('prices notional / fractional orders as the greater of 1% or $0.01', () => {
    assert.equal(orderFeeTotal(preset('ibkr-pro-fixed'), buyCash(0.5, 5)), 0.05); // 1% × $5
    assert.equal(orderFeeTotal(preset('ibkr-pro-fixed'), buyCash(0.1, 0.5)), 0.01); // $0.01 floor
  });

  it('makes a Lite end liquidation commission-free but still regulatory', () => {
    const lite = preset('ibkr-lite');
    assert.deepEqual(kinds(lite, sell(100, 10_000)), ['sec-31', 'finra-taf']);
    assert.equal(amountOf(lite, sell(100, 10_000), 'commission'), 0);
  });

  it('prices dividend reinvestment as the lesser of $1 or 0.1% of value', () => {
    assert.equal(orderFeeTotal(preset('ibkr-lite'), drip(1, 100)), 0.1); // 0.1% × $100
    assert.equal(orderFeeTotal(preset('ibkr-lite'), drip(20, 2_000)), 1); // capped at $1
  });

  it('labels the Tiered base commission and excludes venue costs', () => {
    // Base first-tier: max($0.0035×100, $0.35) = $0.35, under the 1% cap.
    assert.equal(orderFeeTotal(preset('ibkr-pro-tiered'), buyShares(100, 5_000)), 0.35);
  });
});

// --- Custom ------------------------------------------------------------------

describe('custom fee scenario', () => {
  it('never adds hidden SEC, TAF, or CAT charges', () => {
    assert.equal(orderFeeTotal(getBrokerPreset('custom'), sell(100_000, 1_000_000)), 0);
    const withSell = customFees({ sell: { fixed: 5 } });
    assert.deepEqual(kinds(withSell, sell(100_000, 1_000_000)), ['custom']);
    assert.equal(orderFeeTotal(withSell, sell(100_000, 1_000_000)), 5);
  });

  it('applies fixed, per-share, percent, minimum, and maximum to the right side', () => {
    const fees = customFees({ buy: { fixed: 1, perShare: 0.01, percentOfValue: 0.5, minimum: 2, maximum: 10 } });
    // 1 + 0.01×100 + 0.5% × 1000 = 1 + 1 + 5 = 7, above the $2 minimum, below the $10 cap.
    assert.equal(orderFeeTotal(fees, buyShares(100, 1_000)), 7);
    assert.deepEqual(kinds(fees, buyShares(100, 1_000)), ['custom']);
  });
});

// --- Configuration safety ----------------------------------------------------

describe('fee configuration safety', () => {
  it('throws for an unknown preset id instead of silently charging zero', () => {
    const broken: FeeConfig = { ...getBrokerPreset('robinhood'), brokerId: 'typo' };
    assert.throws(() => quoteOrderFee(broken, sell(100_000, 1_000_000)), FeeConfigError);
    // Fails closed even on a degenerate order, before the zero short-circuit.
    assert.throws(() => quoteOrderFee(broken, sell(0, 0)), FeeConfigError);
    assert.throws(() => sharesForCash(1_000, 10, broken, 'contribution-cash'), FeeConfigError);
  });

  it('throws when getBrokerPreset receives an unknown id', () => {
    assert.throws(() => getBrokerPreset('typo'), FeeConfigError);
  });

  it('keeps a custom plan working when its id and name are renamed', () => {
    const renamed: FeeConfig = {
      ...customFees({ sell: { fixed: 5 } }),
      brokerId: 'my-broker-123',
      brokerName: 'My Broker',
    };
    assert.equal(orderFeeTotal(renamed, sell(100_000, 1_000_000)), 5);
    assert.deepEqual(kinds(renamed, sell(100_000, 1_000_000)), ['custom']);
  });
});

// --- Cash-order solver -------------------------------------------------------

describe('sharesForCash cash-order solver', () => {
  const assertMaximal = (cash: number, price: number, fees: FeeConfig, shares: number) => {
    const nextShares = Math.round(shares * 1_000 + 1) / 1_000;
    const nextCost = sharePrincipal(nextShares, price);
    const nextFee = orderFeeTotal(fees, {
      purpose: 'contribution-cash',
      side: 'buy',
      shares: nextShares,
      tradeValue: nextCost,
      price,
    });
    assert.ok(nextCost + nextFee > cash, `next tick ${nextShares} should be unaffordable`);
  };

  it('solves the 100%-of-value fee case that broke the fixed-point loop', () => {
    const fees = customFees({ buy: { percentOfValue: 100 } });
    const order = sharesForCash(100, 1, fees, 'contribution-cash');
    assert.equal(order.shares, 50);
    assert.equal(order.cost, 50);
    assert.equal(order.fee, 50);
    assert.ok(order.cost + order.fee <= 100);
    assertMaximal(100, 1, fees, order.shares);
  });

  it('deducts a fixed commission before sizing the order', () => {
    const fees = customFees({ buy: { fixed: 1 } });
    const order = sharesForCash(100, 1, fees, 'contribution-cash');
    assert.equal(order.shares, 99);
    assert.equal(order.cost, 99);
    assert.equal(order.fee, 1);
    assertMaximal(100, 1, fees, order.shares);
  });

  it('honours a minimum commission floor', () => {
    const fees = customFees({ buy: { perShare: 0.001, minimum: 5 } });
    const order = sharesForCash(1_000, 10, fees, 'contribution-cash');
    assert.equal(order.shares, 99.5);
    assert.equal(order.cost, 995);
    assert.equal(order.fee, 5);
    assertMaximal(1_000, 10, fees, order.shares);
  });

  it('caps the commission at the rule maximum', () => {
    const fees = customFees({ buy: { perShare: 1, maximum: 10 } });
    const order = sharesForCash(1_000, 1, fees, 'contribution-cash');
    assert.equal(order.shares, 990);
    assert.equal(order.cost, 990);
    assert.equal(order.fee, 10);
    assertMaximal(1_000, 1, fees, order.shares);
  });

  it('floors sub-cent priced orders to the 0.001-share tick without overspending', () => {
    const fees = getBrokerPreset('custom');
    const order = sharesForCash(10, 0.007, fees, 'contribution-cash');
    assert.equal(order.shares, 1428.571);
    assert.ok(order.cost + order.fee <= 10);
    assertMaximal(10, 0.007, fees, order.shares);
  });

  it('expands past the naive bound where six-decimal principal rounding hides ticks', () => {
    const fees = getBrokerPreset('custom');
    const order = sharesForCash(1, 0.0001, fees, 'contribution-cash');
    assert.equal(order.shares, 10000.004);
    assert.equal(order.cost, 1);
    assert.ok(order.cost + order.fee <= 1);
    assertMaximal(1, 0.0001, fees, order.shares);
  });

  it('terminates on a much smaller price without overflowing the safe-integer range', () => {
    const fees = getBrokerPreset('custom');
    const order = sharesForCash(1, 0.000001, fees, 'contribution-cash');
    assert.equal(order.shares, 1000000.499);
    assert.ok(order.cost + order.fee <= 1);
    assertMaximal(1, 0.000001, fees, order.shares);
  });

  it('fails to a safe zero order when the tick bound is not representable safely', () => {
    const order = sharesForCash(1, 1e-15, getBrokerPreset('custom'), 'contribution-cash');
    assert.deepEqual(order, { shares: 0, fee: 0, cost: 0, components: [] });
  });

  it('rejects non-finite cash or price with a zero order', () => {
    const fees = getBrokerPreset('custom');
    assert.equal(sharesForCash(Number.POSITIVE_INFINITY, 1, fees, 'contribution-cash').shares, 0);
    assert.equal(sharesForCash(100, Number.NaN, fees, 'contribution-cash').shares, 0);
  });

  it('stays maximal and never overspends under every discontinuous preset branch', () => {
    // Straddles the Moomoo non-US <1-share / ≥1-share jump, the IBKR fractional
    // floor, and the Robinhood/Webull/Moomoo buy branches.
    const cases: Array<[number, number]> = [
      [3, 1],
      [1.5, 1],
      [0.9, 1],
      [5_000, 3.25],
      [250, 17.5],
      [10, 0.05],
    ];
    for (const broker of brokerPresets) {
      for (const [cash, price] of cases) {
        for (const purpose of ['contribution-cash', 'dividend-reinvestment'] as const) {
          const order = sharesForCash(cash, price, broker, purpose);
          assert.ok(order.cost + order.fee <= cash + 1e-9, `${broker.brokerId} overspent`);
          assert.ok(cash - order.cost - order.fee >= -1e-9, `${broker.brokerId} negative residual`);
          if (order.shares > 0) {
            const nextShares = Math.round(order.shares * 1_000 + 1) / 1_000;
            const nextCost = sharePrincipal(nextShares, price);
            const nextFee = orderFeeTotal(broker, {
              purpose: purpose === 'dividend-reinvestment' ? 'dividend-reinvestment' : 'contribution-cash',
              side: 'buy',
              shares: nextShares,
              tradeValue: nextCost,
              price,
            });
            assert.ok(
              nextCost + nextFee > cash,
              `${broker.brokerId} left an affordable tick at cash ${cash} price ${price}`,
            );
          }
        }
      }
    }
  });
});
