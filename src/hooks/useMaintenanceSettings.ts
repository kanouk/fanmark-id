import { useCallback, useEffect, useState } from "react";

import { defaultMaintenanceSettings, fetchMaintenanceSettingsFromWorker, parseMaintenanceSettingsPatch, type MaintenanceSettings, type MaintenanceSettingsPatch, updateMaintenanceSettingsInWorker } from "@/lib/maintenance-settings-api";

const SETTING_KEYS = ["maintenance_mode", "maintenance_message", "maintenance_end_time"] as const;

export function useMaintenanceSettings() {
  const [settings, setSettings] = useState<MaintenanceSettings>(defaultMaintenanceSettings);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
            const next = await fetchMaintenanceSettingsFromWorker();
      setSettings(next);
      return next;
    } catch (cause) {
      const nextError = cause instanceof Error ? cause : new Error("Failed to load maintenance settings");
      setError(nextError);
      throw nextError;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refetch().catch((loadError) => {
      console.error("Failed to load maintenance settings:", loadError);
    });
  }, [refetch]);

  const updateSettings = useCallback(async (rawPatch: MaintenanceSettingsPatch) => {
    const patch = parseMaintenanceSettingsPatch(rawPatch);
        const next = await updateMaintenanceSettingsInWorker(patch);
    setSettings(next);
    setError(null);
    return next;
  }, []);

  return { settings, loading, error, refetch, updateSettings };
}
