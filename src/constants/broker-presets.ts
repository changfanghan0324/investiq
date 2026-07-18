// Purpose: Editable US-stock fee presets verified from broker pages on 2026-07-18.

import type { FeeConfig, FeeRule } from '@/types/backtest';
import { withUsSellRegulatoryFees2026 } from '@/domain/fees';

const zeroRule = (): FeeRule => ({
  fixed: 0,
  perShare: 0,
  percentOfValue: 0,
  minimum: 0,
});

const sellRegulatoryRule = (): FeeRule => withUsSellRegulatoryFees2026(zeroRule());

const EFFECTIVE_DATE = '2026-07-18';
const REGULATORY_NOTE =
  '2026 sell estimate includes SEC Section 31 at $20.60 per $1m (effective 2026-04-04) plus FINRA TAF at $0.000195/share, capped separately at $9.79.';

export const brokerPresets: FeeConfig[] = [
  {
    brokerId: 'robinhood',
    brokerName: 'Robinhood',
    buy: zeroRule(),
    sell: sellRegulatoryRule(),
    dividendReinvestment: zeroRule(),
    notes: `$0 online commission for US stocks and ETFs. ${REGULATORY_NOTE}`,
    effectiveDate: EFFECTIVE_DATE,
  },
  {
    brokerId: 'webull',
    brokerName: 'Webull',
    buy: { ...zeroRule(), perShare: 0.000003 },
    sell: sellRegulatoryRule(),
    dividendReinvestment: zeroRule(),
    notes: `$0 commission; buy estimate includes CAT. ${REGULATORY_NOTE}`,
    effectiveDate: EFFECTIVE_DATE,
  },
  {
    brokerId: 'moomoo-us',
    brokerName: 'Moomoo (US resident)',
    buy: zeroRule(),
    sell: sellRegulatoryRule(),
    dividendReinvestment: zeroRule(),
    notes: `Default $0 commission and platform fee for US residents; other regions differ. ${REGULATORY_NOTE}`,
    effectiveDate: EFFECTIVE_DATE,
  },
  {
    brokerId: 'moomoo-non-us',
    brokerName: 'Moomoo (non-US resident)',
    buy: { ...zeroRule(), perShare: 0.005, minimum: 1 },
    sell: { ...sellRegulatoryRule(), perShare: 0.005, minimum: 1 },
    dividendReinvestment: { ...zeroRule(), percentOfValue: 0.99, maximum: 0.99 },
    notes: `Estimated with a common fixed platform-fee plan; fractional-share and regional pricing may differ. ${REGULATORY_NOTE}`,
    effectiveDate: EFFECTIVE_DATE,
  },
  {
    brokerId: 'firstrade',
    brokerName: 'Firstrade',
    buy: zeroRule(),
    sell: sellRegulatoryRule(),
    dividendReinvestment: zeroRule(),
    notes: `$0 online commission for US stocks and ETFs. ${REGULATORY_NOTE}`,
    effectiveDate: EFFECTIVE_DATE,
  },
  {
    brokerId: 'ibkr-lite',
    brokerName: 'IBKR Lite (recurring investment)',
    buy: { ...zeroRule(), perShare: 0.005, minimum: 1 },
    sell: { ...sellRegulatoryRule(), perShare: 0.005, minimum: 1 },
    dividendReinvestment: { ...zeroRule(), percentOfValue: 0.1, maximum: 1 },
    notes: `IBKR Lite may offer $0 standard trades, while recurring-investment instructions use fixed pricing. ${REGULATORY_NOTE}`,
    effectiveDate: EFFECTIVE_DATE,
  },
  {
    brokerId: 'ibkr-pro-fixed',
    brokerName: 'IBKR Pro Fixed',
    buy: { ...zeroRule(), perShare: 0.005, minimum: 1 },
    sell: { ...sellRegulatoryRule(), perShare: 0.005, minimum: 1 },
    dividendReinvestment: { ...zeroRule(), percentOfValue: 0.1, maximum: 1 },
    notes: `Fixed-price estimate: $0.005 per share, $1 minimum, typically capped at 1% of trade value. ${REGULATORY_NOTE}`,
    effectiveDate: EFFECTIVE_DATE,
  },
  {
    brokerId: 'ibkr-pro-tiered',
    brokerName: 'IBKR Pro Tiered',
    buy: { ...zeroRule(), perShare: 0.003703, minimum: 0.35 },
    sell: { ...sellRegulatoryRule(), perShare: 0.003703, minimum: 0.35 },
    dividendReinvestment: { ...zeroRule(), percentOfValue: 0.1, maximum: 0.35 },
    notes: `Estimated from the lowest volume tier plus clearing fees; actual cost varies by venue and monthly volume. ${REGULATORY_NOTE}`,
    effectiveDate: EFFECTIVE_DATE,
  },
  {
    brokerId: 'custom',
    brokerName: 'Other / custom',
    buy: zeroRule(),
    sell: zeroRule(),
    dividendReinvestment: zeroRule(),
    notes: 'Enter fees from your own brokerage statement.',
    effectiveDate: EFFECTIVE_DATE,
  },
];

export function getBrokerPreset(id: string): FeeConfig {
  const preset = brokerPresets.find((item) => item.brokerId === id) ?? brokerPresets[0];
  return structuredClone(preset);
}
