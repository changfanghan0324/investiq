export type ReadinessStatus = 'checking' | 'ready' | 'degraded' | 'unavailable';
export type ServiceStatus = 'checking' | 'ready' | 'unavailable';
export type DatabaseReadiness = 'checking' | 'configured' | 'unavailable';

/** Public transport contract returned by GET /api/health. */
export interface HealthReport {
  status: Exclude<ReadinessStatus, 'checking'>;
  services: {
    priceAnalysis: Exclude<ServiceStatus, 'checking'>;
    dca: Exclude<ServiceStatus, 'checking'>;
    assistant: Exclude<ServiceStatus, 'checking'>;
    database: 'configured' | 'not-configured';
  };
}

/** Client-facing readiness. Transport vocabulary is normalized for display logic. */
export interface ServiceReadiness {
  readonly overall: ReadinessStatus;
  readonly priceAnalysis: ServiceStatus;
  readonly dca: ServiceStatus;
  readonly assistant: ServiceStatus;
  readonly database: DatabaseReadiness;
}
