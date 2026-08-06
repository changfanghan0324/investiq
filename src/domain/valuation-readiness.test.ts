import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { FSLY_IDENTITY, fslyCompanyFacts } from '@/domain/fixtures/fundamentals-fixtures';
import { buildFundamentals } from '@/domain/fundamentals';
import { buildValuationReadiness } from '@/domain/valuation-readiness';

describe('valuation readiness', () => {
  it('keeps FSLY partially usable and chooses EV / Revenue for negative earnings', () => {
    const readiness = buildValuationReadiness(buildFundamentals(fslyCompanyFacts(), FSLY_IDENTITY));
    assert.equal(readiness.fiscalYear, 2025);
    assert.equal(readiness.anchors.baseRevenue.value, 624_018_000);
    assert.equal(readiness.anchors.baseRevenue.status, 'sec-ready');
    assert.equal(readiness.anchors.dilutedShares.value, 146_902_000);
    assert.equal(readiness.anchors.netDebt.value, 181_276_000);
    assert.equal(readiness.anchors.netDebt.status, 'constructed-ready');
    assert.ok(Math.abs((readiness.anchors.operatingMarginReference.value ?? 0) - (-119_000_000 / 624_018_000)) < 1e-12);
    assert.equal(readiness.anchors.daRevenueReference.status, 'limited-history');
    assert.equal(readiness.anchors.daRevenueReference.observationCount, 1);
    assert.equal(readiness.anchors.capexRevenueReference.observationCount, 5);
    assert.equal(readiness.methods.pe.available, false);
    assert.equal(readiness.methods.pe.reasonCode, 'negative-or-zero-earnings');
    assert.equal(readiness.methods['ev-revenue'].available, true);
    assert.equal(readiness.methods['ev-ebitda'].available, false);
    assert.equal(readiness.defaultComparableMethod, 'ev-revenue');
  });

  it('describes the synthetic no-direct case as constructed instead of reported', () => {
    const readiness = buildValuationReadiness(buildFundamentals(fslyCompanyFacts(false), FSLY_IDENTITY));
    assert.equal(readiness.anchors.baseRevenue.status, 'constructed-ready');
    assert.equal(readiness.anchors.baseRevenue.origin, 'constructed-standard');
    assert.equal(readiness.anchors.baseRevenue.receipts.length, 2);
  });

  it('does not borrow diluted shares from a different fiscal year', () => {
    const facts = fslyCompanyFacts();
    const shares = facts.facts?.['us-gaap']?.WeightedAverageNumberOfDilutedSharesOutstanding?.units?.shares;
    assert.ok(shares);
    shares.shift();
    const readiness = buildValuationReadiness(buildFundamentals(facts, FSLY_IDENTITY));
    assert.equal(readiness.anchors.dilutedShares.status, 'manual-required');
    assert.equal(readiness.anchors.dilutedShares.reasonCode, 'exact-fiscal-year-missing');
    assert.equal(readiness.methods.dcf.available, false);
  });

  it('describes the cash-tax reference as tax divided by pretax income', () => {
    const facts = fslyCompanyFacts();
    const revenueFacts = facts.facts?.['us-gaap']?.RevenueFromContractWithCustomerIncludingAssessedTax?.units?.USD;
    assert.ok(revenueFacts);
    const usGaap = facts.facts?.['us-gaap'];
    assert.ok(usGaap);
    usGaap.IncomeTaxExpenseBenefit = { units: { USD: revenueFacts.map((fact) => ({ ...fact, val: 20 })) } };
    usGaap.IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest = {
      units: { USD: revenueFacts.map((fact) => ({ ...fact, val: 100 })) },
    };
    const readiness = buildValuationReadiness(buildFundamentals(facts, FSLY_IDENTITY));
    assert.equal(readiness.anchors.cashTaxReference.formula, 'incomeTaxExpense / pretaxIncome median');
    assert.equal(readiness.anchors.cashTaxReference.value, 0.2);
  });
});
