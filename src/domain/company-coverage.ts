// Purpose: Classifies SEC Company Facts coverage without presenting issuer-model
// exclusions as service failures. Missing values remain missing; this module only
// gives the UI an honest, decision-useful reason.

import type { FundamentalsMetricKey, FundamentalsResult } from '@/domain/fundamentals';

const FINANCIAL_ISSUER_NOT_APPLICABLE = new Set<FundamentalsMetricKey>([
  'debtCurrent',
  'longTermDebtNoncurrent',
  'totalDebt',
  'netDebt',
  'grossProfit',
  'costOfRevenue',
  'currentAssets',
  'currentLiabilities',
  'inventoryNet',
  'accountsReceivableNetCurrent',
  'accountsPayableCurrent',
]);

export interface CompanyCoverageClassification {
  availableCount: number;
  notApplicable: FundamentalsResult['coverage']['unavailable'];
  notReported: FundamentalsResult['coverage']['unavailable'];
}

export function classifyCompanyCoverage(result: FundamentalsResult): CompanyCoverageClassification {
  const notApplicable: FundamentalsResult['coverage']['unavailable'] = [];
  const notReported: FundamentalsResult['coverage']['unavailable'] = [];

  for (const entry of result.coverage.unavailable) {
    if (result.identity.isFinancialIssuer && FINANCIAL_ISSUER_NOT_APPLICABLE.has(entry.metric)) {
      notApplicable.push(entry);
    } else {
      notReported.push(entry);
    }
  }

  return {
    availableCount: result.metrics.filter((metric) => metric.available).length,
    notApplicable,
    notReported,
  };
}
