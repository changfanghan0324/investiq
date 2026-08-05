import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, it } from 'vitest';

import { AAPL_CASE_SOURCE, type AaplCaseSource } from '@/data/aapl-case-study';
import { buildAaplCaseStudy } from '@/domain/aapl-case-study';
import {
  buildFundamentals,
  type CompanyFacts,
  type FundamentalsMetricKey,
  type FundamentalsResult,
} from '@/domain/fundamentals';
import { catalogs } from '@/i18n/language';
import { renderAaplCaseStudyMarkdown } from '@/services/render-aapl-case-study-markdown';

const view = buildAaplCaseStudy();

describe('AAPL case evidence contract', () => {
  it('constructs the displayed DCF debt bridge from aligned reported components', () => {
    assert.equal(view.bridge.periodEnd, '2025-09-27');
    assert.equal(view.bridge.currentDebt, 20_329_000_000);
    assert.equal(view.bridge.dcfNetDebt, 62_723_000_000);
    assert.equal(view.bridge.marketableSecurities, 96_486_000_000);
    assert.ok(Math.abs(view.bridge.broaderLiquidityImpactPerShare - 6.430386) < 0.000001);
    assert.deepEqual(
      view.bridge.receipts.map((receipt) => receipt.concept),
      [
        'CommercialPaper',
        'LongTermDebtCurrent',
        'LongTermDebtNoncurrent',
        'CashAndCashEquivalentsAtCarryingValue',
        'MarketableSecuritiesCurrent',
        'MarketableSecuritiesNoncurrent',
      ],
    );
    assert.ok(Math.abs((7.979 + 12.350 + 78.328 - 35.934) - 62.723) < 1e-12);
  });

  it('fails closed when any balance-sheet component is not on the snapshot date', () => {
    const source = structuredClone(AAPL_CASE_SOURCE) as AaplCaseSource;
    const cash = source.balanceSheet.find((item) => item.id === 'cashAndEquivalents');
    assert.ok(cash);
    (cash as { periodEnd: string }).periodEnd = '2025-09-26';
    assert.throws(() => buildAaplCaseStudy(source), /align to the case snapshot date/i);
  });

  it('fails closed instead of treating a missing debt or cash component as zero', () => {
    for (const id of ['commercialPaper', 'currentTermDebt', 'noncurrentTermDebt', 'cashAndEquivalents'] as const) {
      const source = structuredClone(AAPL_CASE_SOURCE) as AaplCaseSource;
      (source as { balanceSheet: AaplCaseSource['balanceSheet'] }).balanceSheet = source.balanceSheet.filter(
        (item) => item.id !== id,
      );
      assert.throws(() => buildAaplCaseStudy(source), new RegExp(`${id} is missing`, 'i'));
    }
  });

  it('derives the historical readings from typed observations', () => {
    assert.ok(Math.abs(view.historical.revenueCagr - 0.0327599163) < 1e-10);
    assert.ok(Math.abs(view.historical.medianAnnualRevenueGrowth - 0.0422375293) < 1e-10);
    assert.ok(Math.abs(view.historical.operatingMarginLatest - 0.3197079976) < 1e-10);
    assert.equal(view.historical.freeCashFlowLatest, 98_767_000_000);
    assert.ok(Math.abs(view.historical.dilutedEpsCagr - 0.0738509151) < 1e-10);
    assert.ok(Math.abs(view.historical.capexRevenueMedian - 0.0285923008) < 1e-10);
  });

  it('runs all three scenarios through the existing DCF engine deterministically', () => {
    const outputs = Object.fromEntries(view.scenarios.map((scenario) => [scenario.id, scenario.valuation]));
    assert.ok(Math.abs(outputs.bear.impliedSharePrice - 71.5667953287) < 1e-9);
    assert.ok(Math.abs(outputs.base.impliedSharePrice - 111.2038302817) < 1e-9);
    assert.ok(Math.abs(outputs.bull.impliedSharePrice - 172.6327812192) < 1e-9);
    assert.ok((outputs.bull.assumptions.capexPercentOfRevenue as number) > (outputs.bull.assumptions.daPercentOfRevenue as number));
    assert.deepEqual(
      view.scenarios.map((scenario) => Number(scenario.valuation.terminalValuePercentOfEnterprise?.toFixed(3))),
      [0.681, 0.741, 0.8],
    );
  });

  it('builds a complete, monotonic 5×5 base sensitivity grid', () => {
    assert.equal(view.sensitivity.table.cells.length, 5);
    assert.ok(view.sensitivity.table.cells.every((row) => row.length === 5 && row.every((cell) => cell.available)));
    assert.equal(view.sensitivity.increasesWithTerminalGrowth, true);
    assert.equal(view.sensitivity.decreasesWithWacc, true);
    assert.ok(Math.abs(view.sensitivity.minimum - 86.7708284715) < 1e-9);
    assert.ok(Math.abs(view.sensitivity.maximum - 157.1184009571) < 1e-9);
  });

  it('fails closed when a configured sensitivity cell is financially unavailable', () => {
    const source = structuredClone(AAPL_CASE_SOURCE) as AaplCaseSource;
    (source as { sensitivity: AaplCaseSource['sensitivity'] }).sensitivity = {
      wacc: [0.08],
      terminalGrowth: [0.08],
    };
    assert.throws(() => buildAaplCaseStudy(source), /sensitivity cell is unavailable/i);
  });

  it('keeps every source URL official, HTTPS, and receipt-bearing', () => {
    for (const receipt of view.sourceReceipts) {
      assert.match(receipt.sourceUrl, /^https:\/\/www\.sec\.gov\/Archives\/edgar\//);
      assert.ok(receipt.accn && receipt.concept && receipt.end && receipt.filed);
    }
    for (const citation of view.source.citations) {
      assert.match(citation.url, /^https:\/\/(www\.sec\.gov|www\.apple\.com)\//);
      assert.equal(citation.transcription, 'manual');
    }
  });
});

describe('AAPL typed snapshot and SEC selector parity', () => {
  it('selects the same FY2025 anchors from a compact companyfacts slice', () => {
    const annual = (value: number) => ({
      start: '2024-09-29', end: '2025-09-27', val: value,
      accn: '0000320193-25-000079', fy: 2025, fp: 'FY', form: '10-K', filed: '2025-10-31',
    });
    const instant = (value: number) => ({
      end: '2025-09-27', val: value,
      accn: '0000320193-25-000079', fy: 2025, fp: 'FY', form: '10-K', filed: '2025-10-31',
    });
    const facts: CompanyFacts = {
      cik: 320193,
      entityName: 'Apple Inc.',
      facts: { 'us-gaap': {
        RevenueFromContractWithCustomerExcludingAssessedTax: { units: { USD: [annual(416_161_000_000)] } },
        WeightedAverageNumberOfDilutedSharesOutstanding: { units: { shares: [annual(15_004_697_000)] } },
        CommercialPaper: { units: { USD: [instant(7_979_000_000)] } },
        LongTermDebtCurrent: { units: { USD: [instant(12_350_000_000)] } },
        LongTermDebtNoncurrent: { units: { USD: [instant(78_328_000_000)] } },
        CashAndCashEquivalentsAtCarryingValue: { units: { USD: [instant(35_934_000_000)] } },
      } },
    };
    const result = buildFundamentals(facts, {
      cik: '0000320193', cikNumber: 320193, ticker: 'AAPL', name: 'Apple Inc.', sicCode: 3571,
    });
    assert.equal(metric(result, 'revenue').observations[0].value, view.historical.revenueLatest);
    assert.equal(metric(result, 'dilutedShares').observations[0].value, AAPL_CASE_SOURCE.dilutedWeightedAverageShares.value);
    assert.equal(metric(result, 'debtCurrent').observations[0].value, view.bridge.currentDebt);
    assert.equal(metric(result, 'netDebt').observations[0].value, view.bridge.dcfNetDebt);
  });
});

describe('AAPL public artifact consistency', () => {
  it('keeps the checked-in Markdown byte-equal to the typed renderer', () => {
    const checkedIn = readFileSync(resolve(process.cwd(), 'docs/EQUITY_RESEARCH_SAMPLE_AAPL.md'), 'utf8');
    assert.equal(checkedIn, renderAaplCaseStudyMarkdown());
  });

  it('contains no public local quote comparison or affirmative recommendation language', () => {
    const markdown = renderAaplCaseStudyMarkdown();
    assert.doesNotMatch(markdown, /local acceptance|market comparison|\$333\.43|below the dated market price/i);
    assert.doesNotMatch(markdown, /we recommend|recommend buying|recommend selling|is undervalued|is overvalued/i);
  });

  it('has complete English and Chinese case copy for every language-neutral content key', () => {
    const keys = [
      ...AAPL_CASE_SOURCE.thesisKeys,
      ...AAPL_CASE_SOURCE.invalidationKeys,
      ...AAPL_CASE_SOURCE.unresolvedKeys,
      ...AAPL_CASE_SOURCE.catalysts.flatMap((item) => [item.titleKey, item.textKey, item.monitorKey]),
      ...AAPL_CASE_SOURCE.risks.flatMap((item) => [item.titleKey, item.textKey, item.monitorKey]),
      ...AAPL_CASE_SOURCE.citations.map((item) => item.sectionKey),
    ];
    for (const key of keys) {
      assert.ok(catalogs.en[key].length > 0);
      assert.ok(catalogs['zh-CN'][key].length > 0);
      assert.notEqual(catalogs.en[key], catalogs['zh-CN'][key]);
    }
  });

  it('keeps parameter placeholders aligned across English and Chinese case copy', () => {
    const keys = Object.keys(catalogs.en).filter((key) => key.startsWith('caseStudy.')) as Array<keyof typeof catalogs.en>;
    const placeholders = (value: string) => [...value.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]).sort();
    for (const key of keys) {
      assert.deepEqual(placeholders(catalogs.en[key]), placeholders(catalogs['zh-CN'][key]), String(key));
    }
  });

  it('uses the same latest-reported disclaimer in the English case and fundamentals domain', () => {
    assert.equal(catalogs.en['caseStudy.latestReported'], view.fundamentalsDisclaimer);
  });

  it('keeps Chinese case copy free of affirmative recommendation claims', () => {
    const chineseCaseCopy = Object.entries(catalogs['zh-CN'])
      .filter(([key]) => key.startsWith('caseStudy.'))
      .map(([, value]) => value)
      .join('\n');
    assert.doesNotMatch(chineseCaseCopy, /建议买入|建议卖出|被低估|被高估|保证跑赢/);
  });
});

function metric(result: FundamentalsResult, key: FundamentalsMetricKey) {
  const found = result.metrics.find((item) => item.metric === key);
  assert.ok(found?.available, `${key} should be available`);
  return found;
}
