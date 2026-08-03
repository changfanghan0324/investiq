import { describe, expect, it } from 'vitest';

import { classifyCompanyCoverage } from '@/domain/company-coverage';
import type { FundamentalsResult } from '@/domain/fundamentals';

function result(isFinancialIssuer: boolean): FundamentalsResult {
  return {
    identity: {
      cik: '0001876042',
      ticker: 'CRCL',
      name: 'Circle Internet Group, Inc.',
      isFinancialIssuer,
      sectorClassification: null,
    },
    period: 'annual',
    basis: 'as-most-recently-reported',
    displayOnly: true,
    disclaimer: 'test',
    fiscalYears: [2025],
    metrics: [
      { metric: 'revenue', unit: 'USD', basis: 'Revenue', available: true, observations: [] },
      { metric: 'inventoryNet', unit: 'USD', basis: 'Inventory', available: false, observations: [] },
      { metric: 'interestExpense', unit: 'USD', basis: 'Interest', available: false, observations: [] },
      { metric: 'sharesOutstanding', unit: 'shares', basis: 'Shares', available: false, observations: [] },
    ],
    coverage: {
      unavailable: [
        { metric: 'inventoryNet', reason: 'No standardized annual tag.' },
        { metric: 'interestExpense', reason: 'No standardized annual tag.' },
        { metric: 'sharesOutstanding', reason: 'No standardized annual tag.' },
      ],
    },
  };
}

describe('company coverage classification', () => {
  it('classifies financial-model exclusions separately from genuinely unreported facts', () => {
    const coverage = classifyCompanyCoverage(result(true));

    expect(coverage.availableCount).toBe(1);
    expect(coverage.notApplicable.map((entry) => entry.metric)).toEqual(['inventoryNet']);
    expect(coverage.notReported.map((entry) => entry.metric)).toEqual([
      'interestExpense',
      'sharesOutstanding',
    ]);
  });

  it('does not infer not-applicable status when the issuer is not financial', () => {
    const coverage = classifyCompanyCoverage(result(false));

    expect(coverage.notApplicable).toEqual([]);
    expect(coverage.notReported.map((entry) => entry.metric)).toEqual([
      'inventoryNet',
      'interestExpense',
      'sharesOutstanding',
    ]);
  });
});
