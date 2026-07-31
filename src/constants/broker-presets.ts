// Purpose: Dated, source-backed US-equity fee SCENARIOS verified against official
// broker/regulator pages on 2026-07-29.
//
// These are educational scenarios, not reconstructed historical charges: the
// selected current schedule is applied to every modeled order because reliable
// historical broker schedules are not available for every simulated date. Preset
// schedules are computed by the versioned engine in `@/domain/fees` and are
// read-only — their generic `buy`/`sell`/`dividendReinvestment` rules are unused
// placeholders. Only the "Other / custom" plan is user-editable, and it never
// receives hidden SEC/TAF/CAT charges.

import { FeeConfigError } from '@/domain/fees';
import type { FeeConfig, FeeRule, FeeSourceRef } from '@/types/backtest';

const zeroRule = (): FeeRule => ({
  fixed: 0,
  perShare: 0,
  percentOfValue: 0,
  minimum: 0,
});

/** Date every preset below was last checked against its official source pages. */
const CHECKED_DATE = '2026-07-29';

const SEC_SOURCE: FeeSourceRef = {
  label: 'SEC FY2026 Section 31 fee advisory',
  url: 'https://www.sec.gov/rules-regulations/fee-rate-advisories/2026-2',
};
const FINRA_SOURCE: FeeSourceRef = {
  label: 'FINRA 2026 TAF schedule',
  url: 'https://www.finra.org/rules-guidance/rule-filings/sr-finra-2024-019/fee-adjustment-schedule',
};

/** A read-only preset scenario. The engine ignores the placeholder rules. */
function preset(config: {
  brokerId: string;
  brokerName: string;
  notes: string;
  effectiveDate: string;
  sources: FeeSourceRef[];
}): FeeConfig {
  return {
    brokerId: config.brokerId,
    brokerName: config.brokerName,
    kind: 'preset',
    buy: zeroRule(),
    sell: zeroRule(),
    dividendReinvestment: zeroRule(),
    notes: config.notes,
    effectiveDate: config.effectiveDate,
    checkedDate: CHECKED_DATE,
    sources: config.sources,
  };
}

export const brokerPresets: FeeConfig[] = [
  preset({
    brokerId: 'robinhood',
    brokerName: 'Robinhood',
    notes:
      '$0 online commission for US stocks and ETFs; no CAT charge since 2025-12-01. Modeled sell fees: SEC Section 31 rounded up (not passed through for notional ≤ $500) and FINRA TAF (not passed through for ≤ 50 shares, capped at $9.79).',
    effectiveDate: '2026-04-04',
    sources: [
      { label: 'Robinhood trading fees', url: 'https://robinhood.com/us/en/support/articles/trading-fees-on-robinhood/' },
      SEC_SOURCE,
      FINRA_SOURCE,
    ],
  }),
  preset({
    brokerId: 'webull',
    brokerName: 'Webull',
    notes:
      '$0 stock/ETF commission; CAT ($0.000003/share) is modeled on every execution. Modeled sell fees add SEC Section 31 and FINRA TAF (min $0.01, cap $9.79).',
    effectiveDate: '2026-04-04',
    sources: [
      { label: 'Webull pricing', url: 'https://www.webull.com/pricing' },
      SEC_SOURCE,
      FINRA_SOURCE,
    ],
  }),
  preset({
    brokerId: 'moomoo-us',
    brokerName: 'Moomoo (US resident)',
    notes:
      '$0 commission and $0 promotional platform fee for US residents (the promotion may end with notice). CAT is modeled on both sides; sell adds SEC Section 31 (min $0.01) and FINRA TAF (min $0.01). Dividend reinvestment uses a $0 fee scenario because Moomoo’s DRIP pages conflict on fees.',
    effectiveDate: '2026-05-20',
    sources: [
      { label: 'Moomoo US-resident pricing', url: 'https://www.moomoo.com/us/support/topic4_66' },
      { label: 'Moomoo DRIP terms', url: 'https://www.moomoo.com/us/support/topic4_515' },
      { label: 'Moomoo DRIP help article', url: 'https://www.moomoo.com/us/support/topic4_506' },
      SEC_SOURCE,
      FINRA_SOURCE,
    ],
  }),
  preset({
    brokerId: 'moomoo-non-us',
    brokerName: 'Moomoo (non-US resident)',
    notes:
      'Fixed platform plan. Under 1 share: platform fee 0.99% of value (cap $0.99, rounded up), regulatory fees waived. One share or more: platform $0.005/share (min $1/order) + settlement $0.003/share + CAT, and on sells SEC Section 31 and FINRA TAF (each min $0.01). Dividend reinvestment uses a $0 fee scenario.',
    effectiveDate: '2026-05-20',
    sources: [
      { label: 'Moomoo non-US-resident pricing', url: 'https://www.moomoo.com/us/support/topic4_65/' },
      { label: 'Moomoo DRIP terms', url: 'https://www.moomoo.com/us/support/topic4_515' },
      { label: 'Moomoo DRIP help article', url: 'https://www.moomoo.com/us/support/topic4_506' },
      SEC_SOURCE,
      FINRA_SOURCE,
    ],
  }),
  preset({
    brokerId: 'firstrade',
    brokerName: 'Firstrade',
    notes:
      '$0 commission for US stocks and ETFs; dividend reinvestment is free. Modeled sell fee is SEC Section 31 only — no TAF pass-through is documented on Firstrade’s page. Security-specific ADR custody fees ($0.01–$0.05/share) are excluded from this ordinary-equity preset.',
    effectiveDate: '2026-04-04',
    sources: [
      { label: 'Firstrade pricing', url: 'https://www.firstrade.com/trading/pricing' },
      { label: 'Firstrade special-services pricing', url: 'https://www.firstrade.com/trading/pricing/special-services' },
      SEC_SOURCE,
    ],
  }),
  preset({
    brokerId: 'ibkr-lite',
    brokerName: 'IBKR Lite (recurring investment)',
    notes:
      'Recurring-investment instructions use Fixed pricing: $0.005/share (min $1/order, cap 1% of value); cash/notional and fractional buys pay the greater of 1% of value or $0.01. End liquidation is commission-free but still carries SEC Section 31 and FINRA TAF. Dividend reinvestment commission is the lesser of $1 or 0.1% of value; real DRIP timing and precision differ from this model.',
    effectiveDate: '2026-04-04',
    sources: [
      { label: 'IBKR stock commissions', url: 'https://www.interactivebrokers.com/en/pricing/commissions-stocks.php' },
      SEC_SOURCE,
      FINRA_SOURCE,
    ],
  }),
  preset({
    brokerId: 'ibkr-pro-fixed',
    brokerName: 'IBKR Pro Fixed',
    notes:
      'Fixed pricing: whole-share $0.005/share (min $1/order, cap 1% of value); cash/notional and fractional orders pay the greater of 1% of value or $0.01. Sells add SEC Section 31 and FINRA TAF. Dividend reinvestment commission is the lesser of $1 or 0.1% of value.',
    effectiveDate: '2026-04-04',
    sources: [
      { label: 'IBKR stock commissions', url: 'https://www.interactivebrokers.com/en/pricing/commissions-stocks.php' },
      SEC_SOURCE,
      FINRA_SOURCE,
    ],
  }),
  preset({
    brokerId: 'ibkr-pro-tiered',
    brokerName: 'IBKR Pro Tiered (base estimate)',
    notes:
      'Base commission estimate only: $0.0035/share (min $0.35, cap 1% of value). Exchange, ECN, clearing, liquidity, and monthly-volume effects are unknown from these inputs and are excluded, so this is not an exact total cost. Sells add SEC Section 31 and FINRA TAF.',
    effectiveDate: '2026-04-04',
    sources: [
      { label: 'IBKR stock commissions', url: 'https://www.interactivebrokers.com/en/pricing/commissions-stocks.php' },
      SEC_SOURCE,
      FINRA_SOURCE,
    ],
  }),
  {
    brokerId: 'custom',
    brokerName: 'Other / custom',
    kind: 'custom',
    buy: zeroRule(),
    sell: zeroRule(),
    dividendReinvestment: zeroRule(),
    notes: 'Enter fees from your own brokerage statement. Custom plans never add hidden SEC, TAF, or CAT charges.',
    effectiveDate: CHECKED_DATE,
    checkedDate: CHECKED_DATE,
    sources: [],
  },
];

export function getBrokerPreset(id: string): FeeConfig {
  const preset = brokerPresets.find((item) => item.brokerId === id);
  if (!preset) {
    throw new FeeConfigError(`Unknown broker preset "${id}".`);
  }
  return structuredClone(preset);
}
