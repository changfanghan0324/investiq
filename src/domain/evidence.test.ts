import { describe, expect, it } from 'vitest';

import {
  deriveHealthOverall,
  parseHealthReport,
  tryParseHealthReport,
  unavailableServiceReadiness,
} from '@/domain/evidence';

describe('service-readiness evidence contract', () => {
  it('parses a valid unavailable document independently of HTTP status', () => {
    expect(parseHealthReport({
      status: 'unavailable',
      services: {
        priceAnalysis: 'unavailable',
        dca: 'unavailable',
        assistant: 'ready',
        database: 'configured',
      },
    })).toEqual({
      overall: 'unavailable',
      priceAnalysis: 'unavailable',
      dca: 'unavailable',
      assistant: 'ready',
      database: 'configured',
    });
  });

  it('derives readiness from services rather than trusting top-level status', () => {
    expect(parseHealthReport({
      status: 'ready',
      services: {
        priceAnalysis: 'ready',
        dca: 'unavailable',
        assistant: 'ready',
        database: 'not-configured',
      },
    })).toEqual({
      overall: 'degraded',
      priceAnalysis: 'ready',
      dca: 'unavailable',
      assistant: 'ready',
      database: 'unavailable',
    });
  });

  it.each([
    undefined,
    null,
    '<html>proxy error</html>',
    {},
    { services: {} },
    { services: { priceAnalysis: 'maybe', dca: 'ready', assistant: 'ready', database: 'configured' } },
    { services: { priceAnalysis: 'ready', dca: 'ready', assistant: 'ready', database: 'unknown' } },
  ])('fails closed for malformed or partial payload %#', (payload) => {
    expect(tryParseHealthReport(payload)).toBeUndefined();
    expect(parseHealthReport(payload)).toEqual(unavailableServiceReadiness);
  });

  it('derives the API aggregate without changing independent service fields', () => {
    expect(deriveHealthOverall({
      priceAnalysis: 'ready',
      dca: 'ready',
      assistant: 'ready',
      database: 'configured',
    })).toBe('ready');
    expect(deriveHealthOverall({
      priceAnalysis: 'ready',
      dca: 'unavailable',
      assistant: 'ready',
      database: 'configured',
    })).toBe('degraded');
    expect(deriveHealthOverall({
      priceAnalysis: 'unavailable',
      dca: 'ready',
      assistant: 'ready',
      database: 'configured',
    })).toBe('unavailable');
  });
});
