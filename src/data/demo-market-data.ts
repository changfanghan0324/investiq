// Purpose: Clearly labelled synthetic data so the complete app can be tried without an API key.

import type { DividendEvent, MarketData, PriceBar } from '@/types/backtest';
import { addDays, isWeekday, nextWeekday, todayDateString } from '@/utils/date';

export function createDemoMarketData(ticker = 'DEMO', seed = 1): MarketData {
  const prices: PriceBar[] = [];
  const dividends: DividendEvent[] = [];
  const start = '2018-01-02';
  const end = todayDateString();
  let date = start;
  let index = 0;

  while (date <= end) {
    if (isWeekday(date)) {
      const trend = (36 + seed * 8) * Math.exp(index * (0.00034 + seed * 0.000025));
      const cycle = 1 + Math.sin(index / (27 + seed * 2)) * 0.035 + Math.sin(index / (101 + seed * 7)) * 0.06;
      const shock = date >= '2020-02-20' && date <= '2020-04-15' ? 0.72 + index % 17 / 100 : 1;
      const close = Math.max(8, trend * cycle * shock);
      prices.push({
        date,
        open: close * 0.996,
        high: close * (1.012 + (index % 7) * 0.001),
        low: close * 0.984,
        close,
      });
      index += 1;
    }
    date = addDays(date, 1);
  }

  for (let year = 2018; year <= Number(end.slice(0, 4)); year += 1) {
    for (const month of ['03', '06', '09', '12']) {
      const payDate = nextWeekday(`${year}-${month}-15`);
      if (payDate > end) continue;
      dividends.push({
        id: `demo-${payDate}`,
        exDate: nextWeekday(addDays(payDate, -14)),
        payDate,
        cashAmount: 0.16 + (year - 2018) * 0.012,
        splitAdjustedCashAmount: 0.16 + (year - 2018) * 0.012,
        distributionType: 'recurring',
        frequency: 4,
      });
    }
  }

  return {
    ticker: ticker.trim().toUpperCase() || `DEMO${seed}`,
    name: `${ticker.trim().toUpperCase() || `DEMO${seed}`} Synthetic Demo Asset`,
    currency: 'USD',
    locale: 'us',
    type: 'CS',
    prices,
    dividends,
    splits: [
      {
        id: 'demo-split',
        executionDate: '2021-08-30',
        splitFrom: 1,
        splitTo: 4,
        adjustmentType: 'forward_split',
      },
    ],
    tickerChanges: [],
    source: 'demo',
    fetchedAt: new Date().toISOString(),
  };
}
