import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { getBrokerPreset } from '@/constants/broker-presets';
import { calculateOrderFee } from '@/domain/fees';

describe('US sell regulatory fees', () => {
  it('uses the 2026 SEC rate and caps only the FINRA TAF component', () => {
    const sellRule = getBrokerPreset('robinhood').sell;

    // SEC: $1,000,000 × 0.0000206 = $20.60
    // TAF: min(100,000 × $0.000195, $9.79) = $9.79
    assert.equal(calculateOrderFee(sellRule, 100_000, 1_000_000), 30.39);
  });

  it('adds an uncapped broker commission after independently capping TAF', () => {
    const sellRule = getBrokerPreset('ibkr-pro-fixed').sell;

    // Broker: $500; SEC + capped TAF: $30.39.
    assert.equal(calculateOrderFee(sellRule, 100_000, 1_000_000), 530.39);
  });

  it('uses the uncapped TAF amount for a smaller sale', () => {
    const sellRule = getBrokerPreset('firstrade').sell;

    // SEC: $0.206; TAF: $0.0195; aggregate order fee rounds to cents.
    assert.equal(calculateOrderFee(sellRule, 100, 10_000), 0.23);
  });

  it('does not silently add regulatory fees to a custom rule', () => {
    const sellRule = getBrokerPreset('custom').sell;
    assert.equal(calculateOrderFee(sellRule, 100_000, 1_000_000), 0);
  });
});
