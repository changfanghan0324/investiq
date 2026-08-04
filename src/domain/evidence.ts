import type {
  EvidenceDataMode,
  HealthReport,
  ServiceReadiness,
} from '@/types/evidence';

export const checkingServiceReadiness: ServiceReadiness = Object.freeze({
  overall: 'checking',
  priceAnalysis: 'checking',
  dca: 'checking',
  assistant: 'checking',
  database: 'checking',
});

export const unavailableServiceReadiness: ServiceReadiness = Object.freeze({
  overall: 'unavailable',
  priceAnalysis: 'unavailable',
  dca: 'unavailable',
  assistant: 'unavailable',
  database: 'unavailable',
});

/**
 * Parses each service independently and ignores the aggregate transport status.
 * A malformed or partial document fails closed instead of enabling live work.
 */
export function tryParseHealthReport(payload: unknown): ServiceReadiness | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const services = (payload as { services?: unknown }).services;
  if (!services || typeof services !== 'object') return undefined;

  const candidate = services as Record<string, unknown>;
  if (!isServiceStatus(candidate.priceAnalysis)) return undefined;
  if (!isServiceStatus(candidate.dca)) return undefined;
  if (!isServiceStatus(candidate.assistant)) return undefined;
  if (!isDatabaseStatus(candidate.database)) return undefined;

  const reportServices: HealthReport['services'] = {
    priceAnalysis: candidate.priceAnalysis,
    dca: candidate.dca,
    assistant: candidate.assistant,
    database: candidate.database,
  };
  const database = reportServices.database === 'configured' ? 'configured' : 'unavailable';

  return {
    overall: deriveHealthOverall(reportServices),
    priceAnalysis: reportServices.priceAnalysis,
    dca: reportServices.dca,
    assistant: reportServices.assistant,
    database,
  };
}

export function parseHealthReport(payload: unknown): ServiceReadiness {
  return tryParseHealthReport(payload) ?? unavailableServiceReadiness;
}

/** Compile-time helper for API routes returning the public readiness contract. */
export function healthReport(report: HealthReport): HealthReport {
  return report;
}

export function deriveHealthOverall(
  services: HealthReport['services'],
): HealthReport['status'] {
  if (services.priceAnalysis === 'unavailable') return 'unavailable';
  return services.dca === 'ready'
    && services.assistant === 'ready'
    && services.database === 'configured'
    ? 'ready'
    : 'degraded';
}

export function marketEvidenceMode(options: {
  readiness: ServiceReadiness['priceAnalysis'];
  rendered: 'live' | 'synthetic' | 'none';
}): EvidenceDataMode {
  if (options.rendered === 'synthetic') return 'synthetic-market';
  if (options.rendered === 'live' && options.readiness === 'ready') return 'live-market';
  return 'unavailable';
}

export function secEvidenceMode(hasFiledReceipt: boolean): EvidenceDataMode {
  return hasFiledReceipt ? 'real-sec' : 'unavailable';
}

function isServiceStatus(value: unknown): value is 'ready' | 'unavailable' {
  return value === 'ready' || value === 'unavailable';
}

function isDatabaseStatus(value: unknown): value is 'configured' | 'not-configured' {
  return value === 'configured' || value === 'not-configured';
}
