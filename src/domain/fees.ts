// Purpose: Deterministic commission math shared by contribution, dividend, and sale orders.

import type { FeeRule } from '@/types/backtest';

export const US_SELL_REGULATORY_FEES_2026 = Object.freeze({
  version: 'US-SELL-REGULATORY-2026',
  effectiveDate: '2026-04-04',
  section31RateFraction: 0.0000206,
  finraTafPerShare: 0.000195,
  finraTafMaximum: 9.79,
});

type UsSellRegulatoryFeeConfig = typeof US_SELL_REGULATORY_FEES_2026;
type FeeRuleWithRegulatoryFees = FeeRule & {
  usSellRegulatoryFees?: UsSellRegulatoryFeeConfig;
};

/**
 * Adds the current US sell-side regulatory schedule without folding it into the
 * editable broker commission fields. This keeps the FINRA TAF cap independent
 * from the uncapped SEC Section 31 value assessment and broker commission.
 */
export function withUsSellRegulatoryFees2026(rule: FeeRule): FeeRule {
  return {
    ...rule,
    usSellRegulatoryFees: US_SELL_REGULATORY_FEES_2026,
  } as FeeRuleWithRegulatoryFees;
}

export function calculateOrderFee(rule: FeeRule, shares: number, value: number): number {
  if (shares <= 0 || value <= 0) return 0;

  let brokerFee = rule.fixed + rule.perShare * shares + (rule.percentOfValue / 100) * value;
  if (rule.minimum > 0) brokerFee = Math.max(brokerFee, rule.minimum);
  if (rule.maximum !== undefined && rule.maximum > 0) {
    brokerFee = Math.min(brokerFee, rule.maximum);
  }

  const regulatoryFees = calculateUsSellRegulatoryFees(
    (rule as FeeRuleWithRegulatoryFees).usSellRegulatoryFees,
    shares,
    value,
  );
  return roundMoney(brokerFee + regulatoryFees);
}

function calculateUsSellRegulatoryFees(
  schedule: UsSellRegulatoryFeeConfig | undefined,
  shares: number,
  value: number,
): number {
  if (!schedule || schedule.version !== US_SELL_REGULATORY_FEES_2026.version) return 0;

  const section31 = value * schedule.section31RateFraction;
  const executionPrice = value / shares;
  const taf = executionPrice < schedule.finraTafPerShare
    ? 0
    : Math.min(shares * schedule.finraTafPerShare, schedule.finraTafMaximum);

  return section31 + taf;
}

export function sharesForCash(cash: number, price: number, feeRule: FeeRule): {
  shares: number;
  fee: number;
  cost: number;
} {
  if (cash <= 0 || price <= 0) return { shares: 0, fee: 0, cost: 0 };

  let shares = floorShares(cash / price);
  for (let iteration = 0; iteration < 6; iteration += 1) {
    const value = shares * price;
    const fee = calculateOrderFee(feeRule, shares, value);
    shares = floorShares(Math.max(0, cash - fee) / price);
  }

  const cost = roundMoney(shares * price);
  const fee = calculateOrderFee(feeRule, shares, cost);
  if (cost + fee > cash + 0.000001) {
    shares = floorShares(Math.max(0, cash - fee) / price);
  }

  const finalCost = roundMoney(shares * price);
  return {
    shares,
    fee: calculateOrderFee(feeRule, shares, finalCost),
    cost: finalCost,
  };
}

export function floorShares(value: number): number {
  return Math.floor(Math.max(0, value) * 1_000 + 1e-9) / 1_000;
}

export function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
