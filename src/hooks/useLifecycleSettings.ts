import { useCallback, useEffect, useState } from "react";

import { fetchLifecycleSettingsFromWorker, type LifecycleSettings, LifecycleSettingsApiError, updateGracePeriodInWorker } from "@/lib/lifecycle-settings-api";

const DEFAULT_SETTINGS: LifecycleSettings = { grace_period_days: 1 };

export function useLifecycleSettings() {
  const [settings, setSettings] = useState<LifecycleSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
            const next = await fetchLifecycleSettingsFromWorker();
      setSettings(next);
      return next;
    } catch (cause) {
      const nextError = cause instanceof Error ? cause : new LifecycleSettingsApiError("network");
      setError(nextError);
      throw nextError;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refetch().catch((loadError) => {
      console.error("Failed to load lifecycle settings:", loadError);
    });
  }, [refetch]);

  const updateGracePeriod = useCallback(async (days: number) => {
    if (!Number.isSafeInteger(days) || days < 1 || days > 365) {
      throw new LifecycleSettingsApiError("configuration");
    }
        const next = await updateGracePeriodInWorker(days);
    setSettings(next);
    setError(null);
    return next;
  }, []);

  return { settings, loading, error, refetch, updateGracePeriod };
}
