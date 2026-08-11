// Purpose: Portfolio capital-gain netting — losses offset gains, the flat-rate tax
// is applied once, and the ending balance and return decomposition reconcile.

import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { getBrokerPreset } from '@/constants/broker-presets';
import { BacktestError, runBacktest } from '@/domain/backtest-engine';
import { aggregateBacktestResults } from '@/domain/portfolio-aggregate';
import type { BacktestInput, BacktestResult, FeeRule, MarketData, TaxMode } from '@/types/backtest';

function customFees(rules?: { buy?: Partial<FeeRule>; sell?: Partial<FeeRule> }) {
  const base = getBrokerPreset('custom');
  return {
    ...base,
    buy: { ...base.buy, ...rules?.buy },
    sell: { ...base.sell, ...rules?.sell },
  };
}

function marketData(ticker: string, buyHigh: number, finalClose: number, projected = false): MarketData {
  return {
    ticker,
    name: `${ticker} Inc.`,
    currency: 'USD',
    locale: 'us',
    type: 'CS',
    prices: [
      { date: '2024-01-02', open: buyHigh, high: buyHigh, low: buyHigh, close: buyHigh, projected },
      { date: '2024-01-03', open: finalClose, high: finalClose, low: finalClose, close: finalClose, projected },
    ],
    dividends: [],
    splits: [],
    tickerChanges: [],
    source: 'demo',
    fetchedAt: '2024-01-03T00:00:00.000Z',
    provenance: {
      sourceType: 'synthetic',
      provider: 'InvestIQ deterministic demo generator',
      generatedAt: '2024-01-03T00:00:00.000Z',
      disclaimer: 'This page uses synthetic market series for demonstration. It does not represent actual historical prices or investment performance.',
      priceProvider: 'demo',
      priceBasis: 'split-adjusted',
      fetchedAt: '2024-01-03T00:00:00.000Z',
      dividendCoverage: 'demo',
      totalReturnCoverage: 'demo',
      splitCoverage: 'demo',
      reorganizationCoverage: 'demo',
      mode: 'demo',
    },
  };
}

/** One liquidated holding: a single contribution buy, then sold at the final close. */
function holding(opts: {
  ticker: string;
  contribution: number;
  buyHigh: number;
  finalClose: number;
  taxMode?: TaxMode;
  rate?: number;
  defer?: boolean;
  buyFee?: Partial<FeeRule>;
  sellFee?: Partial<FeeRule>;
  projected?: boolean;
}): BacktestResult {
  const input: BacktestInput = {
    ticker: opts.ticker,
    startDate: '2024-01-02',
    endDate: '2024-01-03',
    investment: { mode: 'amount', value: opts.contribution, intervalValue: 1, intervalUnit: 'years' },
    taxMode: opts.taxMode ?? 'after-tax',
    dividendTaxRate: 0,
    liquidateAtEnd: true,
    capitalGainsTaxRate: opts.rate ?? 0,
    fees: customFees({ buy: opts.buyFee, sell: opts.sellFee }),
    deferCapitalGainsTax: opts.defer ?? true,
  };
  return runBacktest(input, marketData(opts.ticker, opts.buyHigh, opts.finalClose, opts.projected));
}

const afterTax = (rate: number) => ({ mode: 'after-tax' as const, capitalGainsTaxRate: rate });

/** One buy-and-hold holding over a full calendar year: a single contribution, no liquidation. */
function yearHolding(ticker: string, contribution: number, buyHigh: number, finalClose: number): BacktestResult {
  const data: MarketData = {
    ...marketData(ticker, buyHigh, finalClose),
    prices: [
      { date: '2024-01-02', open: buyHigh, high: buyHigh, low: buyHigh, close: buyHigh },
      { date: '2025-01-02', open: finalClose, high: finalClose, low: finalClose, close: finalClose },
    ],
  };
  const input: BacktestInput = {
    ticker,
    startDate: '2024-01-02',
    endDate: '2025-01-02',
    investment: { mode: 'amount', value: contribution, intervalValue: 1, intervalUnit: 'years' },
    taxMode: 'pre-tax',
    dividendTaxRate: 0,
    liquidateAtEnd: false,
    capitalGainsTaxRate: 0,
    fees: getBrokerPreset('custom'),
  };
  return runBacktest(input, data);
}

describe('portfolio money-weighted return', () => {
  it('uses the combined portfolio flows and terminal value, not the average of holding IRRs', () => {
    // 90 shares at 10 → 990 at close (+10%); 10 shares at 10 → 200 at close (+100%).
    const big = yearHolding('BIG', 900, 10, 11);
    const small = yearHolding('SMALL', 100, 10, 20);

    const portfolio = aggregateBacktestResults([big, small], { mode: 'pre-tax', capitalGainsTaxRate: 0 })!;

    // Combined: 1000 contributed, 1190 terminal over ~1 year → ~+19%.
    assert.equal(portfolio.mwrr.status, 'available');
    assert.ok(Math.abs((portfolio.mwrr.annualizedRate as number) - 0.19) < 0.01);

    // The average of the two holding IRRs (~10% and ~100%) is ~55%: far from the
    // dollar-weighted portfolio experience, which the combined-flow MWRR captures.
    const average = ((big.mwrr.annualizedRate as number) + (small.mwrr.annualizedRate as number)) / 2;
    assert.ok(
      Math.abs((portfolio.mwrr.annualizedRate as number) - average) > 0.1,
      'portfolio MWRR must not be the average of component IRRs',
    );
  });

  it('folds the netted portfolio liquidation tax into the aggregate TWR', () => {
    // +$100 gain: 20 shares at 10 → $300 at 15. Holdings defer their capital-gain tax.
    const taxedHolding = holding({ ticker: 'GAIN', contribution: 200, buyHigh: 10, finalClose: 15, taxMode: 'after-tax', rate: 20 });
    const untaxedHolding = holding({ ticker: 'GAIN', contribution: 200, buyHigh: 10, finalClose: 15, taxMode: 'pre-tax', rate: 20 });

    const taxed = aggregateBacktestResults([taxedHolding], afterTax(20))!;
    const untaxed = aggregateBacktestResults([untaxedHolding], { mode: 'pre-tax', capitalGainsTaxRate: 20 })!;

    // $100 gain × 20% = $20 netted once at the portfolio level.
    assert.ok(Math.abs(taxed.capitalGainsTax - 20) < 1e-9);
    // Terminal unit value: taxed 280/200 = 1.40 (−0.40 TWR extra drag) vs untaxed 300/200 = 1.50.
    assert.ok(Math.abs(taxed.twr.cumulative - 0.4) < 1e-9);
    assert.ok(Math.abs(untaxed.twr.cumulative - 0.5) < 1e-9);
    assert.ok(taxed.twr.cumulative < untaxed.twr.cumulative, 'the netted tax lowers the aggregate TWR');
  });
});

describe('portfolio capital-gain netting', () => {
  it('lets a -$100 loss fully offset a +$100 gain (zero taxable gain, zero tax)', () => {
    const gain = holding({ ticker: 'GAIN', contribution: 200, buyHigh: 10, finalClose: 15 }); // +100
    const loss = holding({ ticker: 'LOSS', contribution: 200, buyHigh: 10, finalClose: 5 }); //  -100
    assert.equal(gain.liquidation?.realizedGainLoss, 100);
    assert.equal(loss.liquidation?.realizedGainLoss, -100);

    const portfolio = aggregateBacktestResults([gain, loss], afterTax(20));
    assert.equal(portfolio?.liquidation?.realizedGainLoss, 0);
    assert.equal(portfolio?.liquidation?.taxableGain, 0);
    assert.equal(portfolio?.capitalGainsTax, 0);
    assert.equal(portfolio?.finalAmount, 400); // 300 + 100, untaxed
    assert.equal(portfolio?.totalProfit, 0);
  });

  it('taxes only the netted gain: +$100 and -$40 at 20% is $60 taxable, $12 tax', () => {
    const gain = holding({ ticker: 'GAIN', contribution: 200, buyHigh: 10, finalClose: 15 }); // +100
    const loss = holding({ ticker: 'LOSS', contribution: 200, buyHigh: 10, finalClose: 8 }); //  -40

    const portfolio = aggregateBacktestResults([gain, loss], afterTax(20));
    assert.equal(portfolio?.liquidation?.realizedGainLoss, 60);
    assert.equal(portfolio?.liquidation?.taxableGain, 60);
    assert.equal(portfolio?.capitalGainsTax, 12);
    // 300 + 160 = 460 pre-tax, less the single $12 netted tax.
    assert.ok(Math.abs((portfolio?.finalAmount ?? 0) - 448) < 1e-9);
  });

  it('nets two gains to the summed gain and taxes the total once', () => {
    const a = holding({ ticker: 'AAA', contribution: 200, buyHigh: 10, finalClose: 15 }); // +100
    const b = holding({ ticker: 'BBB', contribution: 200, buyHigh: 10, finalClose: 12.5 }); // +50

    const portfolio = aggregateBacktestResults([a, b], afterTax(20));
    const summed = (a.liquidation?.realizedGainLoss ?? 0) + (b.liquidation?.realizedGainLoss ?? 0);
    assert.equal(summed, 150);
    assert.equal(portfolio?.liquidation?.realizedGainLoss, 150);
    assert.equal(portfolio?.capitalGainsTax, 30); // 150 × 20%
  });

  it('charges no capital-gain tax in pre-tax mode even with a net gain', () => {
    const gain = holding({ ticker: 'GAIN', contribution: 200, buyHigh: 10, finalClose: 15, taxMode: 'pre-tax' });
    const portfolio = aggregateBacktestResults([gain], { mode: 'pre-tax', capitalGainsTaxRate: 20 });
    assert.equal(portfolio?.capitalGainsTax, 0);
    assert.equal(portfolio?.liquidation?.realizedGainLoss, 100);
    assert.equal(portfolio?.finalAmount, 300);
  });

  it('matches a standalone holding for a single-holding portfolio', () => {
    const standalone = runBacktest(
      {
        ticker: 'ONE',
        startDate: '2024-01-02',
        endDate: '2024-01-03',
        investment: { mode: 'amount', value: 200, intervalValue: 1, intervalUnit: 'years' },
        taxMode: 'after-tax',
        dividendTaxRate: 0,
        liquidateAtEnd: true,
        capitalGainsTaxRate: 20,
        fees: getBrokerPreset('custom'),
      },
      marketData('ONE', 10, 15),
    );
    assert.equal(standalone.capitalGainsTax, 20); // 100 × 20%
    assert.equal(standalone.finalAmount, 280);

    const deferred = holding({ ticker: 'ONE', contribution: 200, buyHigh: 10, finalClose: 15, rate: 20 });
    const portfolio = aggregateBacktestResults([deferred], afterTax(20));
    assert.equal(portfolio?.capitalGainsTax, standalone.capitalGainsTax);
    assert.ok(Math.abs((portfolio?.finalAmount ?? 0) - standalone.finalAmount) < 1e-9);
  });

  it('raises basis by acquisition fees and lowers amount realized by the sell fee', () => {
    // $100 contribution, $2 buy fee → $98 buys 9.8 shares; basis 98 + 2 = 100.
    // Sell 9.8 × 15 = 147, less $3 sell fee → 144 realized; gain 44.
    const withFees = holding({
      ticker: 'FEE',
      contribution: 100,
      buyHigh: 10,
      finalClose: 15,
      rate: 10,
      buyFee: { fixed: 2 },
      sellFee: { fixed: 3 },
    });
    assert.equal(withFees.liquidation?.adjustedTaxBasis, 100);
    assert.equal(withFees.liquidation?.netAmountRealized, 144);
    assert.equal(withFees.liquidation?.realizedGainLoss, 44);

    const portfolio = aggregateBacktestResults([withFees], afterTax(10));
    assert.equal(portfolio?.capitalGainsTax, 4.4); // 44 × 10%
  });

  it('reconciles the ending balance with the return decomposition within 1e-6', () => {
    const gain = holding({ ticker: 'GAIN', contribution: 200, buyHigh: 10, finalClose: 15 });
    const loss = holding({ ticker: 'LOSS', contribution: 200, buyHigh: 10, finalClose: 8 });
    const portfolio = aggregateBacktestResults([gain, loss], afterTax(20))!;

    const parts =
      portfolio.priceReturn +
      portfolio.grossDividends -
      portfolio.dividendTax -
      portfolio.capitalGainsTax -
      portfolio.totalFees;
    const balance = portfolio.finalAmount - portfolio.totalContributions;
    assert.ok(Math.abs(parts - balance) < 1e-6);
    assert.ok(Math.abs(portfolio.crossCheckDifference) < 1e-6);
  });

  it('records the netted tax as one non-trade adjustment, not per-holding taxes', () => {
    const gain = holding({ ticker: 'GAIN', contribution: 200, buyHigh: 10, finalClose: 15 });
    const loss = holding({ ticker: 'LOSS', contribution: 200, buyHigh: 10, finalClose: 8 });
    const portfolio = aggregateBacktestResults([gain, loss], afterTax(20))!;

    const liquidations = portfolio.transactions.filter((t) => t.type === 'liquidation');
    assert.ok(liquidations.every((t) => t.tax === 0)); // per-holding tax deferred
    const adjustments = portfolio.transactions.filter((t) => t.type === 'portfolio-tax-adjustment');
    assert.equal(adjustments.length, 1);
    assert.equal(adjustments[0].tax, 12);
    // The ledger tax column reconciles to the portfolio's dividend + capital-gain tax.
    const ledgerTax = portfolio.transactions.reduce((sum, t) => sum + t.tax, 0);
    assert.ok(Math.abs(ledgerTax - (portfolio.dividendTax + portfolio.capitalGainsTax)) < 1e-9);
  });

  it('applies the identical netting rule to a future (projected) scenario', () => {
    const gain = holding({ ticker: 'GAIN', contribution: 200, buyHigh: 10, finalClose: 15, projected: true });
    const loss = holding({ ticker: 'LOSS', contribution: 200, buyHigh: 10, finalClose: 8, projected: true });
    const portfolio = aggregateBacktestResults([gain, loss], afterTax(20));
    assert.equal(portfolio?.projected, true);
    assert.equal(portfolio?.liquidation?.taxableGain, 60);
    assert.equal(portfolio?.capitalGainsTax, 12);
  });
});

describe('portfolio aggregation defensive contract', () => {
  it('throws in netting mode when holdings were already taxed (no double taxation)', () => {
    const taxed = holding({ ticker: 'GAIN', contribution: 200, buyHigh: 10, finalClose: 15, rate: 20, defer: false });
    assert.ok(taxed.capitalGainsTax > 0);
    assert.throws(() => aggregateBacktestResults([taxed], afterTax(20)), BacktestError);
  });

  it('preserves already-applied tax in legacy mode without re-subtracting it', () => {
    const gain = holding({ ticker: 'GAIN', contribution: 200, buyHigh: 10, finalClose: 15, rate: 20, defer: false });
    const loss = holding({ ticker: 'LOSS', contribution: 200, buyHigh: 10, finalClose: 8, rate: 20, defer: false });
    assert.equal(gain.capitalGainsTax, 20); // taxed in isolation, not netted against the loss
    assert.equal(loss.capitalGainsTax, 0);

    const portfolio = aggregateBacktestResults([gain, loss])!; // no tax context → legacy mode
    // Sum of already-applied tax is preserved (20), NOT re-netted down to 12.
    assert.equal(portfolio.capitalGainsTax, 20);
    // Final amounts are summed as-is; the tax is not subtracted a second time.
    assert.equal(portfolio.finalAmount, gain.finalAmount + loss.finalAmount);
    assert.equal(portfolio.finalAmount, 440); // 280 + 160
    // No portfolio-tax adjustment is added; the ledger already carries holding taxes.
    assert.equal(portfolio.transactions.filter((t) => t.type === 'portfolio-tax-adjustment').length, 0);
    const ledgerTax = portfolio.transactions.reduce((sum, t) => sum + t.tax, 0);
    assert.ok(Math.abs(ledgerTax - (portfolio.dividendTax + portfolio.capitalGainsTax)) < 1e-9);
    // Decomposition still reconciles.
    const parts =
      portfolio.priceReturn +
      portfolio.grossDividends -
      portfolio.dividendTax -
      portfolio.capitalGainsTax -
      portfolio.totalFees;
    assert.ok(Math.abs(parts - (portfolio.finalAmount - portfolio.totalContributions)) < 1e-6);
    assert.ok(Math.abs(portfolio.crossCheckDifference) < 1e-6);
  });

  it('stops when a tampered holding result breaks aggregate reconciliation', () => {
    const good = holding({ ticker: 'GAIN', contribution: 200, buyHigh: 10, finalClose: 15 }); // deferred
    const tampered: BacktestResult = { ...good, finalAmount: good.finalAmount + 5 };
    assert.throws(() => aggregateBacktestResults([tampered], afterTax(20)), BacktestError);
  });

  it('keeps a valid deferred portfolio within the reconciliation tolerance', () => {
    const gain = holding({ ticker: 'GAIN', contribution: 200, buyHigh: 10, finalClose: 15 });
    const loss = holding({ ticker: 'LOSS', contribution: 200, buyHigh: 10, finalClose: 8 });
    const portfolio = aggregateBacktestResults([gain, loss], afterTax(20))!;
    assert.ok(Math.abs(portfolio.crossCheckDifference) < 1e-6);
  });
});
