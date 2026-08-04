import { describe, expect, it } from 'vitest';

import {
  deriveHealthOverall,
  marketEvidenceMode,
  parseHealthReport,
  secEvidenceMode,
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

  it('keeps section evidence modes distinct', () => {
    expect(marketEvidenceMode({ readiness: 'ready', rendered: 'live' })).toBe('live-market');
    expect(marketEvidenceMode({ readiness: 'unavailable', rendered: 'synthetic' })).toBe('synthetic-market');
    expect(marketEvidenceMode({ readiness: 'unavailable', rendered: 'none' })).toBe('unavailable');
    expect(marketEvidenceMode({ readiness: 'unavailable', rendered: 'live' })).toBe('unavailable');
    expect(secEvidenceMode(true)).toBe('real-sec');
    expect(secEvidenceMode(false)).toBe('unavailable');
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
