import { useEffect, useRef } from 'react';
import { startPlanProjectionPolling } from '@/lib/plan-projection-polling';

/** Renders and translated callbacks must not restart the bounded confirmation window. */
export function usePlanProjectionPolling({ active, syncKey, refresh, onTimeout }: {
  active: boolean;
  syncKey: string;
  refresh: () => Promise<unknown>;
  onTimeout: () => void;
}) {
  const callbacks = useRef({ refresh, onTimeout });
  useEffect(() => { callbacks.current = { refresh, onTimeout }; }, [refresh, onTimeout]);
  useEffect(() => {
    if (!active) return;
    return startPlanProjectionPolling(() => callbacks.current.refresh(), () => callbacks.current.onTimeout());
  }, [active, syncKey]);
}
