'use client';

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { checkingServiceReadiness, unavailableServiceReadiness } from '@/domain/evidence';
import { loadServiceReadiness } from '@/services/readiness-loader';
import type { ServiceReadiness } from '@/types/evidence';

interface ReadinessContextValue {
  readiness: ServiceReadiness;
  resolved: boolean;
  ensureLoaded: () => void;
  refresh: () => Promise<void>;
}

const ReadinessContext = createContext<ReadinessContextValue | undefined>(undefined);

export function ReadinessProvider({ children }: { children: ReactNode }) {
  const [readiness, setReadiness] = useState<ServiceReadiness>(checkingServiceReadiness);
  const [resolved, setResolved] = useState(false);
  const requestId = useRef(0);
  const started = useRef(false);
  const mounted = useRef(true);

  const apply = useCallback((id: number, next: ServiceReadiness) => {
    if (!mounted.current || id !== requestId.current) return;
    setReadiness(next);
    setResolved(true);
  }, []);

  const ensureLoaded = useCallback(() => {
    if (started.current) return;
    started.current = true;
    const id = ++requestId.current;
    loadServiceReadiness()
      .catch(() => unavailableServiceReadiness)
      .then((next) => apply(id, next));
  }, [apply]);

  const refresh = useCallback(async () => {
    started.current = true;
    const id = ++requestId.current;
    setReadiness(checkingServiceReadiness);
    setResolved(false);
    const next = await loadServiceReadiness({ force: true }).catch(() => unavailableServiceReadiness);
    apply(id, next);
  }, [apply]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      requestId.current += 1;
    };
  }, []);

  const value = useMemo<ReadinessContextValue>(
    () => ({ readiness, resolved, ensureLoaded, refresh }),
    [readiness, resolved, ensureLoaded, refresh],
  );
  return <ReadinessContext.Provider value={value}>{children}</ReadinessContext.Provider>;
}

export function useServiceReadiness(): ReadinessContextValue {
  const context = useContext(ReadinessContext);
  useEffect(() => {
    context?.ensureLoaded();
  }, [context]);
  if (!context) throw new Error('useServiceReadiness must be used inside ReadinessProvider');
  return context;
}
