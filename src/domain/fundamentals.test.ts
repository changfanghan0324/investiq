// Purpose: Deterministic selection tests for the SEC fundamentals domain layer —
// alias precedence, annual duration/form filters, restatement selection, unit
// correctness, fiscal-period alignment, FCF construction/unavailability, 52/53-week
// acceptance vs partial-year rejection, and the financial-SIC capability flag.

import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import {
  FUNDAMENTALS_DISCLAIMER,
  buildFundamentals,
  secFilingIndexUrl,
  type CompanyFacts,
  type FundamentalsIdentityInput,
  type FundamentalsMetricKey,
  type FundamentalsResult,
  type FundamentalsSeries,
  type SecFact,
} from '@/domain/fundamentals';

type Taxonomies = NonNullable<CompanyFacts['facts']>;

function companyFacts(facts: Taxonomies): CompanyFacts {
  return { cik: 320193, entityName: 'Test Co', facts };
}

function identity(overrides: Partial<FundamentalsIdentityInput> = {}): FundamentalsIdentityInput {
  return {
    cik: '0000320193',
    cikNumber: 320193,
    ticker: 'TEST',
    name: 'Test Co',
    ...overrides,
  };
}

/** A full-fiscal-year (364-day) annual fact ending Sep-30 of the given year. */
function annual(fy: number, val: number, over: Partial<SecFact> = {}): SecFact {
  return {
    start: `${fy - 1}-10-01`,
    end: `${fy}-09-30`,
    val,
    accn: `0000320193-${String(fy).slice(2)}-000001`,
    fy,
    fp: 'FY',
    form: '10-K',
    filed: `${fy}-11-03`,
    ...over,
  };
}

function instant(fy: number, val: number, over: Partial<SecFact> = {}): SecFact {
  return {
    end: `${fy}-09-30`,
    val,
    accn: `0000320193-${String(fy).slice(2)}-000001`,
    fy,
    fp: 'FY',
    form: '10-K',
    filed: `${fy}-11-03`,
    ...over,
  };
}

function series(result: FundamentalsResult, key: FundamentalsMetricKey): FundamentalsSeries {
  const found = result.metrics.find((metric) => metric.metric === key);
  assert.ok(found, `missing metric ${key}`);
  return found;
}

describe('concept alias precedence', () => {
  it('prefers the highest-precedence revenue tag present in a fiscal year', () => {
    const facts = companyFacts({
      'us-gaap': {
        RevenueFromContractWithCustomerExcludingAssessedTax: { units: { USD: [annual(2023, 100)] } },
        Revenues: { units: { USD: [annual(2023, 999)] } },
        SalesRevenueNet: { units: { USD: [annual(2023, 1)] } },
      },
    });
    const revenue = series(buildFundamentals(facts, identity()), 'revenue');
    assert.equal(revenue.available, true);
    assert.equal(revenue.observations[0].value, 100);
    assert.equal(revenue.observations[0].receipts[0].concept, 'RevenueFromContractWithCustomerExcludingAssessedTax');
  });

  it('falls through to the next alias when higher-precedence tags are absent', () => {
    const facts = companyFacts({
      'us-gaap': { Revenues: { units: { USD: [annual(2023, 555)] } } },
    });
    const revenue = series(buildFundamentals(facts, identity()), 'revenue');
    assert.equal(revenue.observations[0].value, 555);
    assert.equal(revenue.observations[0].receipts[0].concept, 'Revenues');
  });

  it('may resolve different aliases across different fiscal years', () => {
    const facts = companyFacts({
      'us-gaap': {
        RevenueFromContractWithCustomerExcludingAssessedTax: { units: { USD: [annual(2023, 100)] } },
        Revenues: { units: { USD: [annual(2022, 90)] } },
      },
    });
    const revenue = series(buildFundamentals(facts, identity()), 'revenue');
    const byYear = new Map(revenue.observations.map((o) => [o.fiscalYear, o]));
    assert.equal(byYear.get(2023)?.receipts[0].concept, 'RevenueFromContractWithCustomerExcludingAssessedTax');
    assert.equal(byYear.get(2022)?.receipts[0].concept, 'Revenues');
  });

  it('prefers comprehensive D&A over the PP&E-only depreciation tag', () => {
    const facts = companyFacts({
      'us-gaap': {
        Revenues: { units: { USD: [annual(2023, 1_000)] } },
        DepreciationAndAmortization: { units: { USD: [annual(2023, 80)] } },
        DepreciationDepletionAndAmortizationPropertyPlantAndEquipment: {
          units: { USD: [annual(2023, 50)] },
        },
      },
    });

    const da = series(buildFundamentals(facts, identity()), 'depreciationAndAmortization');
    assert.equal(da.observations[0].value, 80);
    assert.equal(da.observations[0].receipts[0].concept, 'DepreciationAndAmortization');
  });
});

describe('annual duration and form filters', () => {
  it('rejects quarterly periods and non-annual forms, keeping only the annual fact', () => {
    const facts = companyFacts({
      'us-gaap': {
        Revenues: {
          units: {
            USD: [
              annual(2023, 400), // valid 10-K FY
              { start: '2023-07-01', end: '2023-09-30', val: 110, accn: 'q', fy: 2023, fp: 'Q3', form: '10-Q', filed: '2023-10-10' },
              { start: '2022-10-01', end: '2023-09-30', val: 401, accn: 'k8', fy: 2023, fp: 'FY', form: '8-K', filed: '2023-11-05' },
            ],
          },
        },
      },
    });
    const revenue = series(buildFundamentals(facts, identity()), 'revenue');
    assert.equal(revenue.observations.length, 1);
    assert.equal(revenue.observations[0].value, 400);
  });

  it('rejects an FY-labeled 10-K value whose period is not a full year', () => {
    const facts = companyFacts({
      'us-gaap': {
        Revenues: {
          units: {
            USD: [{ start: '2023-04-01', end: '2023-09-30', val: 200, accn: 'stub', fy: 2023, fp: 'FY', form: '10-K', filed: '2023-11-03' }],
          },
        },
      },
    });
    const revenue = series(buildFundamentals(facts, identity()), 'revenue');
    assert.equal(revenue.available, false);
    assert.match(revenue.unavailableReason ?? '', /standard tag/);
  });

  it('accepts a 20-F annual filing', () => {
    const facts = companyFacts({
      'us-gaap': { Revenues: { units: { USD: [annual(2023, 700, { form: '20-F' })] } } },
    });
    assert.equal(series(buildFundamentals(facts, identity()), 'revenue').observations[0].value, 700);
  });
});

describe('restatement selection', () => {
  it('groups comparative facts by economic period instead of the later filing fy', () => {
    const facts = companyFacts({
      'us-gaap': {
        Revenues: {
          units: {
            USD: [
              annual(2023, 100, { fy: 2023, filed: '2023-11-01', accn: 'filed-2023' }),
              annual(2023, 101, { fy: 2024, filed: '2024-11-01', accn: 'filed-2024' }),
              annual(2023, 102, { fy: 2025, filed: '2025-11-01', accn: 'filed-2025' }),
              annual(2025, 125, { fy: 2025, filed: '2025-11-01', accn: 'current-2025' }),
            ],
          },
        },
      },
    });
    const revenue = series(buildFundamentals(facts, identity()), 'revenue');
    assert.deepEqual(revenue.observations.map((item) => item.fiscalYear), [2025, 2023]);
    assert.equal(revenue.observations[1].value, 102);
    assert.equal(revenue.observations[1].periodEnd, '2023-09-30');
    assert.equal(revenue.observations[1].receipts[0].fy, 2025);
    assert.equal(revenue.observations[1].receipts[0].accn, 'filed-2025');
  });

  it('keeps the latest-filed value for a fiscal year (restatement-aware)', () => {
    const facts = companyFacts({
      'us-gaap': {
        NetIncomeLoss: {
          units: {
            USD: [
              annual(2022, 100, { accn: 'orig', filed: '2022-11-01' }),
              annual(2022, 110, { accn: 'restated', filed: '2023-11-01' }),
            ],
          },
        },
      },
    });
    const netIncome = series(buildFundamentals(facts, identity()), 'netIncome');
    assert.equal(netIncome.observations[0].value, 110);
    assert.equal(netIncome.observations[0].receipts[0].filed, '2023-11-01');
  });

  it('prefers the amended annual form on a true filed-date tie', () => {
    const facts = companyFacts({
      'us-gaap': {
        NetIncomeLoss: {
          units: {
            USD: [
              annual(2022, 100, { accn: 'a-original', form: '10-K', filed: '2023-02-01' }),
              annual(2022, 105, { accn: 'b-amended', form: '10-K/A', filed: '2023-02-01' }),
            ],
          },
        },
      },
    });
    const netIncome = series(buildFundamentals(facts, identity()), 'netIncome');
    assert.equal(netIncome.observations[0].value, 105);
    assert.equal(netIncome.observations[0].receipts[0].form, '10-K/A');
  });

  it('deduplicates identical (concept, unit, start, end, accn) facts', () => {
    const dup = annual(2022, 100);
    const facts = companyFacts({
      'us-gaap': { NetIncomeLoss: { units: { USD: [dup, { ...dup }] } } },
    });
    const netIncome = series(buildFundamentals(facts, identity()), 'netIncome');
    assert.equal(netIncome.observations.length, 1);
  });
});

describe('unit correctness', () => {
  it('ignores facts reported under the wrong unit', () => {
    const facts = companyFacts({
      'us-gaap': {
        EarningsPerShareDiluted: {
          units: {
            USD: [annual(2023, 6.13)], // wrong unit for EPS
            'USD/shares': [annual(2023, 6.13)],
          },
        },
        WeightedAverageNumberOfDilutedSharesOutstanding: {
          units: {
            USD: [annual(2023, 15_000_000)], // wrong unit for a share count
            shares: [annual(2023, 15_812_547_000)],
          },
        },
      },
    });
    const result = buildFundamentals(facts, identity());
    const eps = series(result, 'dilutedEps');
    assert.equal(eps.observations[0].value, 6.13);
    assert.equal(eps.observations[0].receipts[0].unit, 'USD/shares');
    const shares = series(result, 'dilutedShares');
    assert.equal(shares.observations[0].value, 15_812_547_000);
    assert.equal(shares.observations[0].receipts[0].unit, 'shares');
  });

  it('accepts an instant shares-outstanding fact and rejects a duration-shaped one', () => {
    const instantFact: SecFact = { end: '2023-10-20', val: 15_550_061_000, accn: 'dei1', fy: 2023, fp: 'FY', form: '10-K', filed: '2023-11-03' };
    const durationFact: SecFact = { start: '2022-10-01', end: '2023-09-30', val: 999, accn: 'dei2', fy: 2023, fp: 'FY', form: '10-K', filed: '2023-11-03' };
    const facts = companyFacts({
      dei: { EntityCommonStockSharesOutstanding: { units: { shares: [instantFact, durationFact] } } },
      'us-gaap': { Revenues: { units: { USD: [annual(2023, 1)] } } },
    });
    const shares = series(buildFundamentals(facts, identity()), 'sharesOutstanding');
    assert.equal(shares.observations.length, 1);
    assert.equal(shares.observations[0].value, 15_550_061_000);
  });
});

describe('fiscal-period alignment', () => {
  it('constructs operating margin only when income and revenue share a period end', () => {
    const facts = companyFacts({
      'us-gaap': {
        OperatingIncomeLoss: { units: { USD: [annual(2023, 30), annual(2022, 25)] } },
        Revenues: {
          units: {
            USD: [
              annual(2023, 100), // aligned end 2023-09-30
              { start: '2022-01-01', end: '2022-12-31', val: 90, accn: 'rev22', fy: 2022, fp: 'FY', form: '10-K', filed: '2023-02-01' },
            ],
          },
        },
      },
    });
    const margin = series(buildFundamentals(facts, identity()), 'operatingMargin');
    const years = margin.observations.map((o) => o.fiscalYear);
    assert.deepEqual(years, [2023]); // 2022 revenue end mismatches operating income end
    assert.ok(Math.abs(margin.observations[0].value - 0.3) < 1e-9);
    assert.equal(margin.observations[0].receipts.length, 2);
  });

  it('skips a margin year where revenue is not strictly positive', () => {
    const facts = companyFacts({
      'us-gaap': {
        OperatingIncomeLoss: { units: { USD: [annual(2023, 30)] } },
        Revenues: { units: { USD: [annual(2023, 0)] } },
      },
    });
    const margin = series(buildFundamentals(facts, identity()), 'operatingMargin');
    assert.equal(margin.available, false);
  });

  it('rejects components with the same fiscal year and end date but different starts', () => {
    const facts = companyFacts({
      'us-gaap': {
        OperatingIncomeLoss: { units: { USD: [annual(2023, 30)] } },
        Revenues: { units: { USD: [annual(2023, 100, { start: '2022-09-25' })] } },
      },
    });
    assert.equal(series(buildFundamentals(facts, identity()), 'operatingMargin').available, false);
  });
});

describe('free cash flow construction', () => {
  it('computes FCF as operating cash flow minus capital expenditure with both receipts', () => {
    const facts = companyFacts({
      'us-gaap': {
        NetCashProvidedByUsedInOperatingActivities: { units: { USD: [annual(2023, 110_543)] } },
        PaymentsToAcquirePropertyPlantAndEquipment: { units: { USD: [annual(2023, 10_959)] } },
      },
    });
    const fcf = series(buildFundamentals(facts, identity()), 'freeCashFlow');
    assert.equal(fcf.available, true);
    assert.equal(fcf.observations[0].value, 110_543 - 10_959);
    assert.equal(fcf.observations[0].receipts.length, 2);
    assert.equal(fcf.observations[0].receipts[0].concept, 'NetCashProvidedByUsedInOperatingActivities');
    assert.equal(fcf.observations[0].receipts[1].concept, 'PaymentsToAcquirePropertyPlantAndEquipment');
  });

  it('reports FCF unavailable with a reason when capex cannot be aligned', () => {
    const facts = companyFacts({
      'us-gaap': {
        NetCashProvidedByUsedInOperatingActivities: { units: { USD: [annual(2023, 110_543)] } },
      },
    });
    const result = buildFundamentals(facts, identity());
    const fcf = series(result, 'freeCashFlow');
    assert.equal(fcf.available, false);
    assert.match(fcf.unavailableReason ?? '', /capital expenditure/);
    assert.ok(result.coverage.unavailable.some((entry) => entry.metric === 'freeCashFlow'));
  });

  it('rejects FCF components whose start dates do not match', () => {
    const facts = companyFacts({
      'us-gaap': {
        NetCashProvidedByUsedInOperatingActivities: { units: { USD: [annual(2023, 100)] } },
        PaymentsToAcquirePropertyPlantAndEquipment: {
          units: { USD: [annual(2023, 10, { start: '2022-09-25' })] },
        },
      },
    });
    assert.equal(series(buildFundamentals(facts, identity()), 'freeCashFlow').available, false);
  });
});

describe('52/53-week acceptance and partial-year rejection', () => {
  it('accepts a 53-week (371-day) fiscal year and rejects a 200-day partial year', () => {
    const facts = companyFacts({
      'us-gaap': {
        Revenues: {
          units: {
            USD: [
              { start: '2022-09-25', end: '2023-09-30', val: 500, accn: 'w53', fy: 2023, fp: 'FY', form: '10-K', filed: '2023-11-03' }, // 370 days
              { start: '2020-03-01', end: '2020-09-16', val: 200, accn: 'partial', fy: 2021, fp: 'FY', form: '10-K', filed: '2021-01-01' }, // 199 days
            ],
          },
        },
      },
    });
    const revenue = series(buildFundamentals(facts, identity()), 'revenue');
    const years = revenue.observations.map((o) => o.fiscalYear);
    assert.deepEqual(years, [2023]);
  });
});

describe('financial-issuer capability flag', () => {
  it('flags SIC 6000–6999 issuers and leaves the rest unflagged', () => {
    const facts = companyFacts({ 'us-gaap': { Revenues: { units: { USD: [annual(2023, 1)] } } } });
    assert.equal(buildFundamentals(facts, identity({ sicCode: 6021, sicDescription: 'National Commercial Banks' })).identity.isFinancialIssuer, true);
    assert.equal(buildFundamentals(facts, identity({ sicCode: 3571 })).identity.isFinancialIssuer, false);
    assert.equal(buildFundamentals(facts, identity()).identity.isFinancialIssuer, false); // unknown SIC fails safe
  });

  it('never fabricates a sector/GICS classification', () => {
    const facts = companyFacts({ 'us-gaap': { Revenues: { units: { USD: [annual(2023, 1)] } } } });
    assert.equal(buildFundamentals(facts, identity()).identity.sectorClassification, null);
  });
});

describe('view shape and windowing', () => {
  it('surfaces at most five fiscal years, latest first, display-only with the disclaimer', () => {
    const revenueFacts: SecFact[] = [];
    for (let fy = 2017; fy <= 2023; fy += 1) revenueFacts.push(annual(fy, fy));
    const facts = companyFacts({ 'us-gaap': { Revenues: { units: { USD: revenueFacts } } } });
    const result = buildFundamentals(facts, identity());
    assert.deepEqual(result.fiscalYears, [2023, 2022, 2021, 2020, 2019]);
    assert.equal(result.displayOnly, true);
    assert.equal(result.period, 'annual');
    assert.equal(result.disclaimer, FUNDAMENTALS_DISCLAIMER);
    const revenue = series(result, 'revenue');
    assert.equal(revenue.observations.length, 5);
    assert.deepEqual(revenue.observations.map((o) => o.fiscalYear), [2023, 2022, 2021, 2020, 2019]);
  });

  it('reports every metric unavailable for a company with no standard facts', () => {
    const result = buildFundamentals(companyFacts({}), identity());
    assert.deepEqual(result.fiscalYears, []);
    assert.ok(result.metrics.every((metric) => metric.available === false));
  });

  it('builds an official SEC filing-index source URL for each receipt', () => {
    const facts = companyFacts({ 'us-gaap': { Revenues: { units: { USD: [annual(2023, 1, { accn: '0000320193-23-000106' })] } } } });
    const revenue = series(buildFundamentals(facts, identity()), 'revenue');
    assert.equal(
      revenue.observations[0].receipts[0].sourceUrl,
      'https://www.sec.gov/Archives/edgar/data/320193/000032019323000106/0000320193-23-000106-index.htm',
    );
    assert.equal(
      secFilingIndexUrl(320193, '0000320193-23-000106'),
      'https://www.sec.gov/Archives/edgar/data/320193/000032019323000106/0000320193-23-000106-index.htm',
    );
  });
});

describe('valuation balance-sheet anchors', () => {
  it('constructs reported EBITDA and net debt only from aligned SEC periods', () => {
    const facts = companyFacts({
      'us-gaap': {
        Revenues: { units: { USD: [annual(2023, 1_000)] } },
        OperatingIncomeLoss: { units: { USD: [annual(2023, 200)] } },
        DepreciationDepletionAndAmortization: { units: { USD: [annual(2023, 35)] } },
        DebtCurrent: { units: { USD: [instant(2023, 100)] } },
        LongTermDebtNoncurrent: { units: { USD: [instant(2023, 400)] } },
        CashAndCashEquivalentsAtCarryingValue: { units: { USD: [instant(2023, 120)] } },
      },
    });

    const result = buildFundamentals(facts, identity());
    const ebitda = series(result, 'ebitda');
    const netDebt = series(result, 'netDebt');

    assert.equal(ebitda.observations[0].value, 235);
    assert.deepEqual(
      ebitda.observations[0].receipts.map((receipt) => receipt.concept),
      ['OperatingIncomeLoss', 'DepreciationDepletionAndAmortization'],
    );
    assert.equal(netDebt.observations[0].value, 380);
    assert.deepEqual(
      netDebt.observations[0].receipts.map((receipt) => receipt.concept),
      ['DebtCurrent', 'LongTermDebtNoncurrent', 'CashAndCashEquivalentsAtCarryingValue'],
    );
  });

  it('keeps net debt unavailable instead of treating missing debt as zero', () => {
    const facts = companyFacts({
      'us-gaap': {
        Revenues: { units: { USD: [annual(2023, 1_000)] } },
        CashAndCashEquivalentsAtCarryingValue: { units: { USD: [instant(2023, 120)] } },
      },
    });

    const netDebt = series(buildFundamentals(facts, identity()), 'netDebt');
    assert.equal(netDebt.available, false);
    assert.deepEqual(netDebt.observations, []);
    assert.match(netDebt.unavailableReason ?? '', /total debt and cash equivalents/i);
  });

  it('allows negative net debt for a net-cash issuer', () => {
    const facts = companyFacts({
      'us-gaap': {
        Revenues: { units: { USD: [annual(2023, 1_000)] } },
        DebtCurrent: { units: { USD: [instant(2023, 10)] } },
        LongTermDebtNoncurrent: { units: { USD: [instant(2023, 40)] } },
        CashAndCashEquivalentsAtCarryingValue: { units: { USD: [instant(2023, 120)] } },
      },
    });

    assert.equal(series(buildFundamentals(facts, identity()), 'netDebt').observations[0].value, -70);
  });
});
